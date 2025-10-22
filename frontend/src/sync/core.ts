// frontend/src/sync/core.ts
// Unified sync engine with deterministic journal drop and safe tokens.
// Adds lightweight diagnostics for SyncInspector.

import { DateTime } from 'luxon'
import { getKeys, readJSON, writeJSON } from './storage'
import { ProviderAdapter, SyncConfig, LocalEvent, PushIntent, PushResult } from './types'
import { popBatch, dropEntries } from './journal'
import { appendDiag } from '../components/dev/SyncInspector'

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

/** Host app local store adapter (wired by importers) */
export type LocalStore = {
  listRange(startISO: string, endISO: string): LocalEvent[]
  upsertMany(rows: LocalEvent[]): void
  applyDeletes(localIds: string[]): void
  rebind(localId: string, boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }): void
}

export async function runSyncOnce(params: {
  adapters: ProviderAdapter[]
  store: LocalStore
  now?: Date
}): Promise<{ ok: boolean; detail?: string }> {
  const cfg = readSyncConfig()
  if (!cfg.enabled) {
    appendDiag({ at: new Date().toISOString(), phase: 'done', note: 'sync disabled' })
    return { ok: true, detail: 'sync disabled' }
  }

  const now = (params.now ? DateTime.fromJSDate(params.now) : DateTime.local())
  const start = now.startOf('day').toISO()!
  const end = now.plus({ weeks: cfg.windowWeeks || 8 }).endOf('day').toISO()!

  appendDiag({ at: new Date().toISOString(), phase: 'run', note: 'start', data: { start, end } })

  const tokens = readTokens()

  // ---------- PULL ----------
  for (const ad of params.adapters) {
    const t = tokens[ad.provider]?.sinceToken ?? null
    try {
      appendDiag({ at: new Date().toISOString(), phase: 'pull', note: ad.provider, data: { token: t } })
      const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })

      // map RemoteDelta → local upserts/deletes
      const upserts: LocalEvent[] = []
      const deletes: string[] = []

      for (const d of res.events) {
        if (d.operation === 'delete') {
          // Optionally: resolve local id(s) tied to externalId for deletion.
          // Your current app doesn’t maintain reverse index → skip local delete to avoid false positives.
          continue
        } else if (d.payload) {
          upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) params.store.upsertMany(upserts)
      // if (deletes.length) params.store.applyDeletes(deletes)

      // Safe token handling per provider
      const prev = tokens[ad.provider] || { sinceToken: null as string | null }
      tokens[ad.provider] = {
        sinceToken: res.token ?? prev.sinceToken ?? null,
        lastRunISO: now.toISO()!,
      }
      writeTokens(tokens)
    } catch (e: any) {
      appendDiag({ at: new Date().toISOString(), phase: 'error', note: `pull ${ad.provider}`, data: String(e?.message || e) })
      // Continue with other providers and PUSH phase anyway
    }
  }

  // ---------- PUSH ----------
  const batch = popBatch(50)
  if (batch.length === 0) {
    appendDiag({ at: new Date().toISOString(), phase: 'done', note: 'no journal' })
    return { ok: true }
  }

  // Build deterministic keys for each journal entry
  type Key = string
  const makeKey = (a: string, e: LocalEvent) => `${a}:${e.id}:${e.start}:${e.end}:${e.title || ''}`

  // Prepare a lookup from deterministic key -> journalId(s)
  const keyToJids = new Map<Key, string[]>()
  const entries = batch.map(j => {
    const candidate = params.store.listRange(j.at, j.at)[0] || { id: j.eventId, title: '', start: j.at, end: j.at } as any as LocalEvent
    const k = makeKey(j.action, candidate)
    const arr = keyToJids.get(k) || []
    arr.push(j.journalId)
    keyToJids.set(k, arr)
    return { j, ev: candidate, key: k }
  })

  appendDiag({ at: new Date().toISOString(), phase: 'push', note: `intents=${entries.length}` })

  for (const ad of params.adapters) {
    try {
      const intents: PushIntent[] = entries.map(({ j, ev }) => ({
        action: j.action,
        local: ev,
        // adapters usually ignore extra props; if your types allow, you can add journalId
        // @ts-ignore
        journalId: j.journalId,
      }))
      const rs = await ad.push(intents)

      // Deterministic drop: match results to our key set
      const okJids: string[] = []
      for (const r of rs) {
        if (!r.ok) continue
        // Build the same key used above
        const local = entries.find(x => x.ev.id === r.localId)?.ev
        if (!local) continue
        const k = makeKey(r.action, local)
        const ids = keyToJids.get(k)
        if (ids && ids.length) {
          okJids.push(ids.shift()!) // drop exactly one journal entry per success
          if (r.bound) {
            // apply new/updated binding
            try { params.store.rebind(r.localId, r.bound) } catch {}
          }
        }
      }
      if (okJids.length) dropEntries(okJids)
    } catch (e) {
      appendDiag({ at: new Date().toISOString(), phase: 'error', note: `push ${ad.provider}`, data: String(e) })
    }
  }

  appendDiag({ at: new Date().toISOString(), phase: 'done' })
  return { ok: true }
}
