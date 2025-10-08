// frontend/src/sync/bootstrap.ts
// Slice D bootstrap: runs the unified sync loop if enabled in config.

import { DateTime } from 'luxon'
import { runSyncOnce, readSyncConfig } from './core'
import { createGoogleAdapter } from './google'
import type { LocalStore, LocalEvent } from './types'
import { listExpanded } from '../state/events-agenda'
import * as base from '../state/events'

// Minimal LocalStore adapter bridging to your existing state layer
const store: LocalStore = {
  listRange(startISO, endISO) {
    const start = DateTime.fromISO(startISO)
    const end = DateTime.fromISO(endISO)
    // empty query → all events
    return listExpanded(start, end, '') as unknown as LocalEvent[]
  },
  upsertMany(rows: LocalEvent[]) {
    for (const r of rows) {
      base.upsertEvent(r as any, 'series')
    }
  },
  applyDeletes(localIds: string[]) {
    // Optional: if your remote returns deletes mapped to localIds, call base.deleteEvent here.
    // For D1, we leave deletes no-op.
  },
  rebind(localId, bound) {
    // If you have a direct getter, use it; otherwise do a cheap range lookup around "now".
    // This path is rarely hit in D1 (Google stub), but implemented for completeness.
    const now = DateTime.local()
    const near = listExpanded(now.minus({ weeks: 52 }), now.plus({ weeks: 52 }), '')
    const ev = near.find(e => (e as any).id === localId)
    if (!ev) return
    const remoteArr = Array.isArray((ev as any)._remote) ? (ev as any)._remote : []
    const nextRemote = [
      ...remoteArr.filter((r: any) => !(r.provider === bound.provider && r.calendarId === bound.calendarId)),
      bound,
    ]
    const next = { ...(ev as any), _remote: nextRemote }
    base.upsertEvent(next as any, 'series')
  },
}

/** Run sync once (only if enabled) */
export async function maybeRunSync() {
  const cfg = readSyncConfig()
  if (!cfg.enabled) return
  const adapters = []

  if (cfg.providers.google?.enabled) {
    adapters.push(createGoogleAdapter({
      accountKey: cfg.providers.google.accountKey,
      calendars: cfg.providers.google.calendars,
    }))
  }
  // Apple adapter will plug in here in D3.

  await runSyncOnce({ adapters, store })
}

/** Start a background loop (only does work if enabled) */
let _loopId: number | null = null
export function startSyncLoop(intervalMs = 5 * 60 * 1000) {
  if (_loopId !== null) return
  const tick = () => { maybeRunSync().catch(() => {}) }
  _loopId = window.setInterval(tick, intervalMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick()
  })
  // first tick soon after load
  window.setTimeout(tick, 1500)
}
