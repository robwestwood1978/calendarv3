// frontend/src/sync/runner.ts
// Bridges the sync engine to your local store + registers the Google adapter.

import { DateTime } from 'luxon'
import { runSyncOnce, readSyncConfig, type LocalStore } from './core'
import { createGoogleAdapter } from './google'

// ---- Local store bridge ----------------------------------------------------
// We try to use your agenda store if available. If not, we fall back to a shim
// that reads/writes your existing localStorage event array (fc_events_*).

type LocalEvt = {
  id: string
  title: string
  start: string
  end: string
  allDay?: boolean
  notes?: string
  location?: string
  attendees?: string[]
  tags?: string[]
  colour?: string
  _remote?: Array<{ provider: string; calendarId: string; externalId: string; etag?: string }>
}

function getLSKey(): string {
  // prefer your newest key if it exists
  const keys = ['fc_events_v3', 'fc_events_v2', 'fc_events_v1']
  for (const k of keys) {
    try { if (localStorage.getItem(k)) return k } catch {}
  }
  return 'fc_events_v1'
}

function readAll(): LocalEvt[] {
  try {
    const raw = localStorage.getItem(getLSKey())
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeAll(rows: LocalEvt[]) {
  try { localStorage.setItem(getLSKey(), JSON.stringify(rows)) } catch {}
}

function overlaps(aStartISO: string, aEndISO: string, bStartISO: string, bEndISO: string) {
  const aS = +new Date(aStartISO); const aE = +new Date(aEndISO)
  const bS = +new Date(bStartISO); const bE = +new Date(bEndISO)
  return aS <= bE && bS <= aE
}

const shimStore: LocalStore = {
  listRange(startISO, endISO) {
    const all = readAll()
    return all.filter(e => overlaps(e.start, e.end, startISO, endISO))
  },
  upsertMany(rows) {
    const all = readAll()
    const byId = new Map(all.map(r => [r.id, r]))
    for (const r of rows as LocalEvt[]) {
      byId.set(r.id, { ...(byId.get(r.id) || {}), ...r })
    }
    writeAll(Array.from(byId.values()))
  },
  applyDeletes(localIds) {
    const all = readAll()
    const next = all.filter(e => !localIds.includes(e.id))
    writeAll(next)
  },
  rebind(localId, bound) {
    const all = readAll()
    const idx = all.findIndex(e => e.id === localId)
    if (idx >= 0) {
      const rem = Array.isArray(all[idx]._remote) ? all[idx]._remote : []
      // replace existing binding for this provider or add new
      const rest = rem.filter(r => !(r.provider === bound.provider && r.externalId === bound.externalId))
      all[idx]._remote = [...rest, bound]
      writeAll(all)
    }
  },
}

// Optional: try to pull stronger helpers from your app if present
function tryAppStore(): LocalStore {
  try {
    // If you later add stronger, typed helpers, export them and use them here.
    // @ts-ignore
    const api = window.__fcStoreBridge
    if (api && typeof api.listRange === 'function' && typeof api.upsertMany === 'function') {
      return api as LocalStore
    }
  } catch {}
  return shimStore
}

// ---- Runner ----------------------------------------------------------------

export async function runOnce() {
  const cfg = readSyncConfig()
  if (!cfg?.enabled) {
    return { ok: true, detail: 'sync disabled' }
  }

  const adapters = []
  if (cfg.providers?.google?.enabled) {
    adapters.push(
      createGoogleAdapter({
        accountKey: cfg.providers.google.accountKey || 'google-default',
        calendars: cfg.providers.google.calendars && cfg.providers.google.calendars.length
          ? cfg.providers.google.calendars
          : ['primary'],
      })
    )
  }

  if (adapters.length === 0) {
    return { ok: true, detail: 'no providers' }
  }

  const now = DateTime.local().toJSDate()
  const res = await runSyncOnce({
    adapters,
    store: tryAppStore(),
    now,
  })
  return res
}
