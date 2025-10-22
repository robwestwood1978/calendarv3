// frontend/src/sync/runner.ts
// PATCH v3.1 — Sync runner (pull + push) with strict locking, clean logging, and journal hygiene.
// - Builds adapters from SyncConfig (Google only for now; Apple/ICS handled elsewhere)
// - Pulls windowed deltas (or syncToken via adapter), upserts into local store
// - Pushes journal → provider with duplicate-defense and proper rebinding
// - Single-flight lock: ignores overlapping runs (prevents dupe fan-out)
// - Listens for `fc:sync-now` custom event (your “Sync now” button)

import { DateTime } from 'luxon'
import { readSyncConfig, readTokens, writeTokens, type LocalStore } from './core'
import { popBatch, dropEntries } from './journal'
import type { ProviderAdapter, PushIntent, PushResult, LocalEvent, RemoteDelta } from './types'
import { createGoogleAdapter } from './google'
import { getLocalStore } from './localStore'

// ---------- logging helpers ----------
const LOG_ON = true
const log  = (...a: any[]) => { if (LOG_ON) console.log('[sync]', ...a) }
const warn = (...a: any[]) => { if (LOG_ON) console.warn('[sync]', ...a) }

function brief(ev: Partial<LocalEvent> | undefined) {
  if (!ev) return ev
  return { id: ev.id, title: ev.title, start: ev.start, end: ev.end, allDay: (ev as any).allDay }
}

// ---------- single-flight run guard ----------
let running = false
let lastRunISO: string | null = null

export function isRunning() { return running }
export function lastRunAt() { return lastRunISO }

// ---------- adapter factory ----------
function buildAdapters(): ProviderAdapter[] {
  const cfg = readSyncConfig()
  const adapters: ProviderAdapter[] = []
  if (!cfg?.enabled) return adapters

  if (cfg.providers?.google?.enabled) {
    adapters.push(
      createGoogleAdapter({
        accountKey: cfg.providers.google.accountKey || 'google-default',
        calendars: Array.isArray(cfg.providers.google.calendars) && cfg.providers.google.calendars.length
          ? cfg.providers.google.calendars
          : ['primary'],
      })
    )
  }

  // NOTE: Apple/ICS “pull only” lives in integrations flow — not a ProviderAdapter here.
  return adapters
}

// ---------- window calculation ----------
function getWindowRange(weeks: number) {
  const now = DateTime.local()
  const start = now.startOf('day').toISO()!
  const end   = now.plus({ weeks: weeks || 8 }).endOf('day').toISO()!
  return { start, end }
}

// ---------- PULL phase ----------
async function doPull(ad: ProviderAdapter, store: LocalStore, startISO: string, endISO: string) {
  const tokens = readTokens()
  const sinceToken = tokens?.[ad.provider]?.sinceToken ?? null

  let res: { token: string | null, events: RemoteDelta[] }
  try {
    res = await ad.pull({ sinceToken, rangeStartISO: startISO, rangeEndISO: endISO })
  } catch (e) {
    warn('pull failed for', ad.provider, e)
    return
  }

  const upserts: LocalEvent[] = []
  const deletes: string[] = [] // left for a binding-aware implementation

  for (const d of res.events) {
    if (d.operation === 'delete') {
      // If you map remote IDs → local IDs elsewhere, call store.applyDeletes([...]) here.
      // For now we skip hard deletes (read-only “pull delete”).
      continue
    }
    if (d.operation === 'upsert' && d.payload) {
      // payload already shaped as LocalEvent by adapter
      upserts.push(d.payload as LocalEvent)
    }
  }

  if (upserts.length) {
    try {
      store.upsertMany(upserts)
      log('[pull] upserts', upserts.length)
    } catch (e) {
      warn('[pull] upsertMany failed', e)
    }
  }
  if (deletes.length) {
    try {
      store.applyDeletes(deletes)
      log('[pull] deletes', deletes.length)
    } catch (e) {
      warn('[pull] applyDeletes failed', e)
    }
  }

  // persist sync token
  const t = readTokens()
  const next = {
    ...t,
    [ad.provider]: {
      sinceToken: res.token ?? (t?.[ad.provider]?.sinceToken ?? null),
      lastRunISO: DateTime.local().toISO(),
    },
  }
  writeTokens(next)
}

// ---------- PUSH phase ----------
async function doPush(ad: ProviderAdapter, store: LocalStore) {
  // Drain a batch from the journal
  const batch = popBatch(50)
  if (!batch.length) return

  // Construct intents:
  // We resolve a LocalEvent snapshot per journal entry based on its timestamp “at”.
  const intents: PushIntent[] = batch.map(j => {
    const snapshot = store.listRange(j.at, j.at)[0] // single event at that timestamp if present
    const local: LocalEvent = snapshot || {
      // minimal fallback — adapter will validate dates
      id: j.eventId,
      title: (j.after as any)?.title || (j.before as any)?.title || '',
      start: (j.after as any)?.start || (j.before as any)?.start || new Date().toISOString(),
      end:   (j.after as any)?.end   || (j.before as any)?.end   || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    } as any

    return { action: j.action, local }
  })

  log('[sync] push intents:', intents.length)

  let results: PushResult[] = []
  try {
    results = await ad.push(intents)
  } catch (e) {
    warn('push failed for', ad.provider, e)
    return
  }

  // Drop successful journal entries and apply provider bindings
  const okIds: string[] = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const j = batch[i]
    if (!j) continue

    if (r.ok) {
      okIds.push(j.journalId)
      if (r.bound) {
        // Adapter returned a definitive binding (provider + calendarId + externalId + etag)
        try { store.rebind(r.localId, r.bound) } catch (e) { warn('rebind failed', r, e) }
      }
    }
  }

  if (okIds.length) {
    try { dropEntries(okIds) } catch (e) { warn('dropEntries failed', e) }
  }

  const ok = results.filter(r => r.ok).length
  log('[sync] push success:', ok, 'of', results.length)
}

// ---------- Public: run once ----------
export async function runSyncOnce(): Promise<{ ok: boolean; detail?: string }> {
  if (running) {
    log('skip: already running')
    return { ok: true, detail: 'already running' }
  }
  running = true
  lastRunISO = DateTime.local().toISO()
  log('run…', JSON.stringify(lastRunISO))

  const cfg = readSyncConfig()
  if (!cfg?.enabled) {
    running = false
    return { ok: true, detail: 'sync disabled' }
  }

  const store = getLocalStore()
  const adapters = buildAdapters()
  if (!adapters.length) {
    running = false
    return { ok: true, detail: 'no adapters' }
  }

  const { start, end } = getWindowRange(cfg.windowWeeks || 8)

  try {
    // PULL
    for (const ad of adapters) {
      await doPull(ad, store, start, end)
    }

    // PUSH
    for (const ad of adapters) {
      await doPush(ad, store)
    }
  } catch (e) {
    warn('run failed:', e)
    running = false
    return { ok: false, detail: String(e) }
  }

  running = false
  log('done:', { ok: true })
  return { ok: true }
}

// ---------- Wire a “Sync now” event for your button ----------
const onSyncNow = async () => { try { await runSyncOnce() } catch {} }

try {
  window.addEventListener('fc:sync-now', onSyncNow as any)
} catch { /* SSR / tests */ }

// (Optional) expose for dev tools
;(window as any).__FC_SYNC_RUN__ = runSyncOnce
