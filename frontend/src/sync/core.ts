// frontend/src/sync/core.ts
// Unified sync engine: windowed pull, journal-driven push, conflict policy.

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
  rebind(
    localId: string,
    boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }
  ): void
}

export async function runSyncOnce(params: {
  adapters?: ProviderAdapter[] | null
  store: LocalStore
  now?: Date
}): Promise<{ ok: boolean; detail?: string }> {
  // Guard: nothing to do until adapters are provided
  if (!params.adapters || params.adapters.length === 0) {
    return { ok: true, detail: 'no adapters' }
  }

  const cfg = readSyncConfig()
  if (!cfg.enabled) return { ok: true, detail: 'sync disabled' }

  const now = params.now ? DateTime.fromJSDate(params.now) : DateTime.local()
  const start = now.startOf('day').toISO()!
  const end = now.plus({ weeks: cfg.windowWeeks }).endOf('day').toISO()!

  const tokens = readTokens()

  // 1) PULL phase — provider deltas into local
  for (const ad of params.adapters) {
    if (!ad || !ad.provider || typeof ad.pull !== 'function') continue
    const t = tokens[ad.provider]?.sinceToken ?? null
    try {
      const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })

      const upserts: LocalEvent[] = []
      // const deletes: string[] = []  // hook if you wire delete mapping

      for (const d of res.events) {
        if (d.operation === 'delete') {
          // delete mapping optional — your store can do binding lookups
          continue
        } else if (d.payload) {
          upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) params.store.upsertMany(upserts)

      tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
      writeTokens(tokens)
    } catch (e) {
      console.warn(`pull failed for ${ad.provider}`, e)
    }
  }

  // 2) PUSH phase — drain local journal as push intents
  const batch = popBatch(50)
  if (batch.length === 0) return { ok: true }

  for (const ad of params.adapters) {
    if (!ad || typeof ad.push !== 'function') continue
    try {
      const intents: PushIntent[] = batch.map((j) => ({
        action: j.action,
        local:
          params.store.listRange(j.at, j.at)[0] ||
          ({ id: j.eventId, title: '', start: j.at, end: j.at } as any),
      }))
      const rs: PushResult[] = await ad.push(intents)

      // Drop successful journal entries
      const okIds = rs
        .map((r, i) => (r.ok ? batch[i]?.journalId : undefined))
        .filter(Boolean) as string[]
      if (okIds.length) dropEntries(okIds)

      // Apply bindings for newly created/updated items
      for (const r of rs) {
        if (r.ok && r.bound) {
          params.store.rebind(r.localId, r.bound)
        }
      }
    } catch (e) {
      console.warn(`push failed for ${ad.provider}`, e)
    }
  }

  return { ok: true }
}
