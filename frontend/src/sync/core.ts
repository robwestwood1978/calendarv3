// frontend/src/sync/core.ts
// Unified sync engine: windowed pull, journal-driven push, conflict policy.
// Push is driven directly from journal snapshots (no re-lookup by time).

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

  console.log('[sync] run…', now.toISO())

  // 1) PULL phase — provider deltas into local
  for (const ad of params.adapters) {
    const t = tokens[ad.provider]?.sinceToken ?? null
    try {
      const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })
      const upserts: LocalEvent[] = []
      const deletes: string[] = []

      for (const d of res.events) {
        if (d.operation === 'delete') {
          // OPTIONAL: resolve local id by external binding if you track that mapping
          // deletes.push(localId)
        } else if (d.payload) {
          upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) params.store.upsertMany(upserts)
      if (deletes.length) params.store.applyDeletes(deletes)

      tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
      writeTokens(tokens)
    } catch (e: any) {
      console.warn(`[sync] pull failed for ${ad.provider}:`, e)
    }
  }

  // 2) PUSH phase — drain local journal as push intents
  const batch = popBatch(50)
  if (batch.length === 0) {
    console.log('[sync] done:', { ok: true })
    return { ok: true }
  }

  // Build intents *from the journal snapshots* (no listRange re-lookup)
  const intents: PushIntent[] = batch.map(j => {
    // For create/update the newest state is in j.after; for delete prefer j.before.
    const snap = (j.after || j.before || {}) as Partial<LocalEvent>
    const fallbackISO = new Date(j.at).toISOString()
    const local: LocalEvent = {
      id: j.eventId,
      title: snap.title || '(No title)',
      start: snap.start || fallbackISO,
      end: snap.end || fallbackISO,
      allDay: (snap as any).allDay,
      location: snap.location,
      notes: snap.notes,
      attendees: (snap as any).attendees,
      tags: (snap as any).tags,
      colour: (snap as any).colour,
      _remote: (snap as any)._remote, // preserve bindings so updates go to Google
    } as any
    return { action: j.action, local }
  })

  console.log('[sync] push intents:', intents.length)

  // Send to each adapter (right now you only have google enabled)
  for (const ad of params.adapters) {
    try {
      const results: PushResult[] = await ad.push(intents)
      // Drop only entries whose corresponding result.ok is true (index-aligned)
      const okJournalIds = results
        .map((r, idx) => ({ r, j: batch[idx] }))
        .filter(x => x.r && x.r.ok && x.j)
        .map(x => x.j!.journalId)

      if (okJournalIds.length) dropEntries(okJournalIds)

      // Apply bindings returned from adapter (e.g., new Google event id/etag)
      for (const r of results) {
        if (r.ok && r.bound && r.localId) {
          params.store.rebind(r.localId, r.bound)
        }
      }

      console.log('[sync] push success:', okJournalIds.length, 'of', results.length)
    } catch (e) {
      console.warn(`[sync] push failed for ${ad.provider}:`, e)
    }
  }

  console.log('[sync] done:', { ok: true })
  return { ok: true }
}
