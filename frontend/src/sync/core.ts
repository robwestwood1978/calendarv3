// frontend/src/sync/core.ts
// Unified sync engine: windowed pull, journal-driven push, conflict policy (safe).

import { DateTime } from 'luxon'
import { getKeys, readJSON, writeJSON } from './storage'
import { ProviderAdapter, SyncConfig, LocalEvent, PushIntent, PushResult } from './types'
import { popBatch, dropEntries } from './journal'

const LS = getKeys()

type TokenState = {
  [provider: string]: {
    sinceToken: string | null
    lastRunISO?: string
  }
}

export function readSyncConfig(): SyncConfig {
  return readJSON<SyncConfig>(LS.SYNC_CFG, {
    enabled: false,
    providers: { google: { enabled: false }, apple: { enabled: false } },
    windowWeeks: 8,
  })
}

export function writeSyncConfig(cfg: SyncConfig) {
  writeJSON(LS.SYNC_CFG, cfg)
}

export function readTokens(): TokenState {
  return readJSON<TokenState>(LS.SYNC_TOKENS, {})
}

export function writeTokens(t: TokenState) {
  writeJSON(LS.SYNC_TOKENS, t)
}

/** Wire this to your local event store read/write */
export type LocalStore = {
  listRange(startISO: string, endISO: string): LocalEvent[]
  upsertMany(rows: LocalEvent[]): void
  applyDeletes(localIds: string[]): void
  rebind(localId: string, boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }): void
}

function isISO(x: any): x is string {
  if (typeof x !== 'string') return false
  const d = new Date(x)
  return !isNaN(+d)
}

function validLocal(ev: any): ev is LocalEvent {
  return ev && typeof ev === 'object' && typeof ev.id === 'string' && isISO(ev.start) && isISO(ev.end)
}

export async function runSyncOnce(params: {
  adapters: ProviderAdapter[]
  store: LocalStore
  now?: Date
}): Promise<{ ok: boolean; detail?: string }> {
  const cfg = readSyncConfig()
  if (!cfg.enabled) return { ok: true, detail: 'sync disabled' }

  const now = (params.now ? DateTime.fromJSDate(params.now) : DateTime.local())
  const start = now.startOf('day').toISO()!
  const end = now.plus({ weeks: cfg.windowWeeks }).endOf('day').toISO()!

  const tokens = readTokens()

  // 1) PULL — provider deltas -> local
  for (const ad of params.adapters) {
    const t = tokens[ad.provider]?.sinceToken ?? null
    try {
      const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })

      const upserts: LocalEvent[] = []
      // const deletes: string[] = []   // if you resolve deletes to local ids, call applyDeletes

      for (const d of res.events) {
        if (d.operation === 'delete') {
          // left to your store to map remote → local and delete
          continue
        } else if (d.payload) {
          upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) params.store.upsertMany(upserts)

      tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
      writeTokens(tokens)
    } catch (e: any) {
      console.warn(`[sync][pull] failed for ${ad.provider}`, e)
    }
  }

  // 2) PUSH — drain journal as push intents (use journal snapshots, not listRange)
  const batch = popBatch(50)
  if (batch.length === 0) return { ok: true }

  // Build intents once from journal
  const intents: PushIntent[] = []
  for (const j of batch) {
    let local: any
    if (j.action === 'delete') {
      local = j.before || null
    } else {
      local = j.after || null
    }
    if (!validLocal(local)) {
      console.warn('[sync][push] skip journal row with invalid local snapshot:', j)
      continue
    }
    intents.push({ action: j.action, local })
  }

  if (intents.length === 0) return { ok: true }

  let anyOk = false
  for (const ad of params.adapters) {
    try {
      console.log('[sync] push intents:', intents.length, '→', ad.provider)
      const rs = await ad.push(intents)
      const okIdx: number[] = []
      rs.forEach((r, i) => { if (r.ok) okIdx.push(i) })
      anyOk = anyOk || okIdx.length > 0

      // Drop by matching positions in the original 'batch' that were included in intents
      // We need to align results to intents. Build a list of journalIds we can drop:
      const dropIds: string[] = []
      let intentCursor = 0
      for (let bi = 0; bi < batch.length && intentCursor < intents.length; bi++) {
        const j = batch[bi]
        const intended = intents[intentCursor]
        // match by eventId + action (good enough for journal rows in order)
        if (j.eventId === intended.local.id && j.action === intended.action) {
          // if corresponding result ok, drop this row
          const wasOk = rs[intentCursor]?.ok
          if (wasOk) dropIds.push(j.journalId)
          intentCursor++
        }
      }
      if (dropIds.length) dropEntries(dropIds)

      // Apply new bindings (e.g., newly created externalId)
      for (const r of rs) {
        if (r.ok && r.bound) {
          params.store.rebind(r.localId, r.bound)
        }
      }

      console.log('[sync] push success:', okIdx.length, 'of', rs.length)
    } catch (e) {
      console.warn(`[sync][push] failed for ${ad.provider}`, e)
    }
  }

  return { ok: true }
}
