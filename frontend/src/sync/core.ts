// frontend/src/sync/core.ts
// Unified sync engine: windowed pull, journal-driven push, conflict policy.
// (2025-10-17) — journal drain fix + clearer tracing.

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

      const upserts: LocalEvent[] = []
      // (Optional) collect deletes here if your store can resolve local ids by binding
      // const deletes: string[] = []

      for (const d of res.events) {
        if (d.operation === 'delete') {
          // left to store-level mapping if you keep remote bindings → applyDeletes([...])
          continue
        } else if (d.payload) {
          upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) params.store.upsertMany(upserts)

      tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
      writeTokens(tokens)
    } catch (e: any) {
      console.warn(`[sync] pull failed for ${ad.provider}`, e)
    }
  }

  // 2) PUSH phase — drain local journal as push intents
  const batch = popBatch(50)
  if (batch.length === 0) return { ok: true }

  // Build intents once; adapter can ignore intents it can't handle
  // (In a binding-aware flow you’d route by provider/target.)
  const intents: PushIntent[] = batch.map(j => ({
    action: j.action,
    // Provide a minimal local stub; adapter can refetch as needed
    local: params.store.listRange(j.at, j.at)[0] || { id: j.eventId, title: '', start: j.at, end: j.at } as any
  }))

  for (const ad of params.adapters) {
    try {
      const rs: PushResult[] = await ad.push(intents)

      // === CRITICAL FIX: drain journal by zipping results to batch indices ===
      const okIds: string[] = []
      for (let i = 0; i < rs.length && i < batch.length; i++) {
        const r = rs[i]
        if (r && r.ok) okIds.push(batch[i].journalId)
        if (r && r.ok && r.bound) {
          // Persist the remote binding so the next push is PATCH not INSERT
          try { params.store.rebind(r.localId, r.bound) } catch (e) { console.warn('[sync] rebind failed', e) }
        }
      }
      if (okIds.length) dropEntries(okIds)

    } catch (e) {
      console.warn(`[sync] push failed for ${ad.provider}`, e)
    }
  }

  return { ok: true }
}
