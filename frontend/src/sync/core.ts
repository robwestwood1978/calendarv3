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

  console.log('[sync] run…', now.toISO())

  const tokens = readTokens()

  // 1) PULL phase — provider deltas into local
  for (const ad of params.adapters) {
    const t = tokens[ad.provider]?.sinceToken ?? null
    try {
      const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })

      const upserts: LocalEvent[] = []
      // NOTE: deletes are left for binding-aware implementations; no-op here

      for (const d of res.events) {
        if (d.operation === 'upsert' && d.payload) {
          upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) params.store.upsertMany(upserts)

      tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
      writeTokens(tokens)
    } catch (e: any) {
      console.warn(`pull failed for ${ad.provider}`, e)
    }
  }

  // 2) PUSH phase — drain local journal as push intents
  const batch = popBatch(50)
  if (batch.length === 0) {
    console.log('[sync] done:', { ok: true })
    return { ok: true }
  }

  // Build intents from journal snapshots in-order and keep a parallel journalId list
  const intents: PushIntent[] = batch.map(j => {
    // prefer "after" for create/update; "before" for delete
    const snapshot: any =
      j.action === 'delete' ? (j.before || {}) :
      (j.after || j.before || {})

    const local: LocalEvent = {
      id: snapshot.id,
      title: snapshot.title || '',
      start: snapshot.start,
      end: snapshot.end,
      allDay: snapshot.allDay,
      notes: snapshot.notes,
      location: snapshot.location,
      attendees: snapshot.attendees,
      rrule: snapshot.rrule,
      colour: snapshot.colour,
      _remote: snapshot._remote, // keep any existing binding(s)
    }

    return { action: j.action, local }
  })

  console.log('[sync] push intents:', intents.length)

  // Send to each provider; drop exactly the entries that succeeded by index
  for (const ad of params.adapters) {
    try {
      const rs: PushResult[] = await ad.push(intents)

      // Map results back to the same position and collect journalIds that succeeded
      const okJournalIds: string[] = []
      rs.forEach((r, i) => {
        if (r?.ok) {
          const je = batch[i]
          if (je?.journalId) okJournalIds.push(je.journalId)
          // Apply new binding if the adapter returned it
          if (r.bound && r.localId) {
            params.store.rebind(r.localId, r.bound)
          }
        }
      })

      if (okJournalIds.length) {
        dropEntries(okJournalIds)
      }

      console.log('[sync] push success:', okJournalIds.length, 'of', batch.length)
    } catch (e) {
      console.warn(`push failed for ${ad.provider}`, e)
    }
  }

  console.log('[sync] done:', { ok: true })
  return { ok: true }
}
