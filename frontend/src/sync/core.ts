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
  rebind(localId: string, boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }): void
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

  // 1) PULL phase — provider deltas into local
  for (const ad of params.adapters) {
    const t = tokens[ad.provider]?.sinceToken ?? null
    try {
      const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })
      // map RemoteDelta → local upserts/deletes
      const upserts: LocalEvent[] = []
      const deletes: string[] = []

      for (const d of res.events) {
        if (d.operation === 'delete') {
          // If you store remote bindings, resolve local id by binding (left to your store)
          // Here we skip and let your store handle delete mapping externally if needed
          continue
        } else {
          // minimal upsert; your adapter should already map payload fields to LocalEvent
          if (d.payload) upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) params.store.upsertMany(upserts)
      // deletes: optional -> params.store.applyDeletes(deletes)

      tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
      writeTokens(tokens)
    } catch (e: any) {
      // log and continue with other providers
      console.warn(`pull failed for ${ad.provider}`, e)
    }
  }

  // 2) PUSH phase — drain local journal as push intents
  const batch = popBatch(50)
  if (batch.length === 0) return { ok: true }

  // Build intents per provider; for now we route to all enabled providers
  const results: PushResult[] = []
  for (const ad of params.adapters) {
    try {
      // In a real binding-aware flow, select only entries bound (or targetable) for that provider
      const intents: PushIntent[] = batch.map(j => ({
        action: j.action,
        local: params.store.listRange(j.at, j.at)[0] || { id: j.eventId, title: '', start: j.at, end: j.at } as any
      }))
      const rs = await ad.push(intents)
      results.push(...rs)
      // If success, drop those journal ids
      const okIds = rs.filter(r => r.ok).map((_, i) => batch[i]?.journalId).filter(Boolean) as string[]
      if (okIds.length) dropEntries(okIds)
      // Apply new bindings
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
