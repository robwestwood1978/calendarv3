// Unified sync engine: windowed pull, journal-driven push, conflict policy.
// CHANGE: Push phase now builds intents from the journal snapshots (before/after)
// so we don't depend on store lookups that may return stale/empty results.

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

/** Local store contract used during PULL and for binding updates. */
export type LocalStore = {
  listRange(startISO: string, endISO: string): LocalEvent[]
  upsertMany(rows: LocalEvent[]): void
  applyDeletes(localIds: string[]): void
  rebind(localId: string, boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }): void
}

/** Build a minimal LocalEvent from a journal snapshot (after || before). */
function eventFromSnapshot(j: any): LocalEvent | null {
  const snap: any = j?.after || j?.before
  if (!snap) return null
  // ensure id/title/start/end exist enough for adapters to work
  const id = j?.eventId || snap?.id
  const start = snap?.start
  const end = snap?.end || snap?.start
  if (!id || !start) return null

  const ev: LocalEvent = {
    id,
    title: (snap.title || '').toString(),
    start,
    end,
    allDay: !!snap.allDay,
    location: snap.location,
    notes: snap.notes,
    attendees: Array.isArray(snap.attendees) ? snap.attendees.slice() : undefined,
    tags: Array.isArray(snap.tags) ? snap.tags.slice() : undefined,
    bring: Array.isArray(snap.bring) ? snap.bring.slice() : undefined,
    colour: snap.colour,
    rrule: snap.rrule,
    _remote: Array.isArray(snap._remote) ? snap._remote : undefined,
  } as any
  return ev
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

  // ---------------- 1) PULL phase ----------------
  for (const ad of params.adapters) {
    try {
      const t = tokens[ad.provider]?.sinceToken ?? null
      const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })

      const upserts: LocalEvent[] = []
      const deletes: string[] = []

      for (const d of res.events) {
        if (d.operation === 'delete') {
          // Optional: collect local ids to delete if you maintain a binding index.
          // We'll leave delete mapping to your store layer later if needed.
          // deletes.push(localIdMappedFromBinding)
          continue
        } else if (d.payload) {
          upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) params.store.upsertMany(upserts)
      if (deletes.length) params.store.applyDeletes(deletes)

      tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
      writeTokens(tokens)
    } catch (e: any) {
      console.warn(`pull failed for ${ad.provider}`, e)
    }
  }

  // ---------------- 2) PUSH phase ----------------
  const batch = popBatch(50)
  if (batch.length === 0) return { ok: true }

  // Create intents directly from journal snapshots
  type IntentWithId = { intent: PushIntent, journalId: string }
  const intentsForProvider: Record<string, IntentWithId[]> = {}

  for (const j of batch) {
    const action = j.action // 'create' | 'update' | 'delete'
    const local = eventFromSnapshot(j)
    // For delete, we allow missing local snapshot; the adapter can use binding info if present.
    if (!local && action !== 'delete') continue

    // Route to all enabled providers for now; smarter routing can be added later.
    for (const ad of params.adapters) {
      if (!intentsForProvider[ad.provider]) intentsForProvider[ad.provider] = []
      intentsForProvider[ad.provider].push({
        intent: { action: action as any, local: (local || { id: j.eventId } as any) },
        journalId: j.journalId,
      })
    }
  }

  // Nothing to push
  const totalIntents = Object.values(intentsForProvider).reduce((n, arr) => n + arr.length, 0)
  if (totalIntents === 0) return { ok: true }

  try {
    console.log('[sync] push intents:', totalIntents)
  } catch {}

  const succeeded: Set<string> = new Set()

  for (const ad of params.adapters) {
    const pack = intentsForProvider[ad.provider]
    if (!pack || pack.length === 0) continue

    // Maintain index mapping so we can mark successes precisely
    const intents = pack.map(p => p.intent)
    let results: PushResult[] = []
    try {
      results = await ad.push(intents)
    } catch (e) {
      console.warn(`push failed for ${ad.provider}`, e)
      continue
    }

    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx]
      const jid = pack[idx]?.journalId
      if (!jid) continue
      if (r && r.ok) {
        succeeded.add(jid)
        // If adapter returned a new binding, persist it
        if (r.bound) {
          try { params.store.rebind(r.localId, r.bound) } catch {}
        }
      }
    }
  }

  if (succeeded.size > 0) {
    dropEntries(Array.from(succeeded))
  }

  try {
    console.log('[sync] push success:', succeeded.size, 'of', totalIntents)
  } catch {}

  return { ok: true }
}
