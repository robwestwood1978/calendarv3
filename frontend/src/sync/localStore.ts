// LocalStore adapter used by the sync engine to read/write your app’s events.

import type { LocalEvent } from './types'
import type { LocalStore } from './core'
import { DateTime } from 'luxon'

const KEYS = ['fc_events_v3', 'fc_events_v2', 'fc_events_v1']

function readEvents(): LocalEvent[] {
  for (const k of KEYS) {
    const s = localStorage.getItem(k)
    if (!s) continue
    try {
      const arr = JSON.parse(s)
      if (Array.isArray(arr)) return arr as LocalEvent[]
    } catch {}
  }
  return []
}

function writeEvents(list: LocalEvent[]) {
  // Prefer the newest key if present, else fall back to v1
  const dest = localStorage.getItem('fc_events_v3') != null
    ? 'fc_events_v3'
    : localStorage.getItem('fc_events_v2') != null
      ? 'fc_events_v2'
      : 'fc_events_v1'
  localStorage.setItem(dest, JSON.stringify(list))
  try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
}

export const localStore: LocalStore = {
  listRange(startISO: string, endISO: string) {
    const start = DateTime.fromISO(startISO)
    const end = DateTime.fromISO(endISO)
    return readEvents().filter(e => {
      const s = DateTime.fromISO(e.start)
      const f = DateTime.fromISO(e.end)
      return s.isValid && f.isValid && (
        (s >= start && s <= end) || (f >= start && f <= end) || (s < start && f > end)
      )
    })
  },

  upsertMany(rows: LocalEvent[]) {
    const idx = new Map(readEvents().map(e => [e.id, e] as const))
    for (const r of rows) idx.set(r.id, r)
    writeEvents(Array.from(idx.values()))
  },

  applyDeletes(localIds: string[]) {
    const set = new Set(localIds)
    const next = readEvents().filter(e => !set.has(e.id))
    writeEvents(next)
  },

  rebind(localId, boundRef) {
    const list = readEvents()
    const i = list.findIndex(e => e.id === localId)
    if (i < 0) return
    const cur = list[i] as any
    const rem = Array.isArray(cur._remote) ? cur._remote.slice() : []
    const j = rem.findIndex((r: any) => r?.provider === boundRef.provider && r?.calendarId === boundRef.calendarId)
    if (j >= 0) rem[j] = { ...rem[j], ...boundRef }
    else rem.push({ ...boundRef })
    list[i] = { ...cur, _remote: rem }
    writeEvents(list)
  },
}
