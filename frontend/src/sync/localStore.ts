// frontend/src/sync/localStore.ts
// Minimal LocalStore wrapper over localStorage. Good enough for sync bootstrap.
// If your app persists events elsewhere, adjust EVENTS_KEY or replace these
// methods with calls into your real event store.

import { DateTime } from 'luxon'
import { type LocalStore } from './core'

type Attendee = string
export type LocalEvent = {
  id: string
  title: string
  start: string // ISO
  end: string   // ISO
  allDay?: boolean
  location?: string
  notes?: string
  attendees?: Attendee[]
  rrule?: string
  colour?: string
  _remote?: Array<{
    provider: 'google' | string
    calendarId: string
    externalId: string
    etag?: string
  }>
}

const EVENTS_KEY = 'fc_events_v1' // matches your main.tsx reset list

function readEvents(): LocalEvent[] {
  try { return JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]') } catch { return [] }
}
function writeEvents(rows: LocalEvent[]) {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(rows))
  try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const a0 = DateTime.fromISO(aStart).toMillis()
  const a1 = DateTime.fromISO(aEnd).toMillis()
  const b0 = DateTime.fromISO(bStart).toMillis()
  const b1 = DateTime.fromISO(bEnd).toMillis()
  return a0 <= b1 && b0 <= a1
}

export function getLocalStore(): LocalStore {
  return {
    listRange(startISO: string, endISO: string) {
      const all = readEvents()
      return all.filter(e => overlaps(e.start, e.end, startISO, endISO))
    },
    upsertMany(rows: LocalEvent[]) {
      const all = readEvents()
      const byId = new Map(all.map(e => [e.id, e]))
      for (const r of rows) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r })
      writeEvents(Array.from(byId.values()))
    },
    applyDeletes(localIds: string[]) {
      if (!localIds?.length) return
      const set = new Set(localIds)
      const next = readEvents().filter(e => !set.has(e.id))
      writeEvents(next)
    },
    rebind(localId, bound) {
      const all = readEvents()
      const idx = all.findIndex(e => e.id === localId)
      if (idx < 0) return
      const ev = { ...all[idx] }
      const list = Array.isArray(ev._remote) ? [...ev._remote] : []
      const i2 = list.findIndex(x => x.provider === bound.provider && x.calendarId === bound.calendarId)
      if (i2 >= 0) list[i2] = { ...list[i2], ...bound }
      else list.push({ ...bound })
      ev._remote = list
      all[idx] = ev
      writeEvents(all)
    },
  }
}
