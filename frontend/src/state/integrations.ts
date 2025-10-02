// External calendar integrations state (read-only overlays).
// Stores calendars in fc_integrations_v1 and parsed events in fc_external_events_v1.
// Fully behind feature flags: integrations + provider flags (apple/google/classroom).

import type { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'
import { icsToEvents } from '../utils/ics'

type Provider = 'apple' | 'google' | 'ics'

export type ExternalCalendar = {
  id: string
  provider: Provider
  name: string
  url: string
  color?: string
  enabled: boolean
  lastSyncISO?: string
  etag?: string
  assignedMemberIds?: string[] // calendar → members mapping for My Agenda
}

const LS_FLAGS   = 'fc_feature_flags_v1'
const LS_INTS    = 'fc_integrations_v1'
const LS_EXT     = 'fc_external_events_v1'
const LS_SETTINGS= 'fc_settings_v3' // to read member list for UI

type Flags = { integrations?: boolean; apple?: boolean; google?: boolean; classroom?: boolean }

function readFlags(): Flags { try { return JSON.parse(localStorage.getItem(LS_FLAGS) || '{}') } catch { return {} } }
function safeParse<T=any>(raw: string | null): T | null { if (!raw) return null; try { return JSON.parse(raw) as T } catch { return null } }
function writeLS(key: string, val: any) { localStorage.setItem(key, JSON.stringify(val)) }

export function listCalendars(): ExternalCalendar[] {
  const s = safeParse<{ calendars?: ExternalCalendar[] }>(localStorage.getItem(LS_INTS)) || {}
  return Array.isArray(s.calendars) ? s.calendars : []
}
export function saveCalendars(next: ExternalCalendar[]) {
  const cur = safeParse<any>(localStorage.getItem(LS_INTS)) || {}
  cur.calendars = next; writeLS(LS_INTS, cur)
  try { window.dispatchEvent(new CustomEvent('fc:integrations:changed')) } catch {}
}
export function addCalendar(cal: Omit<ExternalCalendar, 'id'|'enabled'> & { enabled?: boolean }): ExternalCalendar {
  const next: ExternalCalendar = { id: `cal_${Date.now()}_${Math.random().toString(36).slice(2)}`, enabled: true, assignedMemberIds: [], ...cal }
  const list = listCalendars(); saveCalendars([ ...list, next ]); return next
}
export function updateCalendar(id: string, patch: Partial<ExternalCalendar>) {
  const next = listCalendars().map(c => c.id === id ? { ...c, ...patch } : c)
  saveCalendars(next)
}

export async function refreshCalendar(cal: ExternalCalendar, apiFetchICS: (url: string) => Promise<string>): Promise<number> {
  if (cal.provider === 'apple' || cal.provider === 'ics' || (cal.provider === 'google' && cal.url.endsWith('.ics'))) {
    const text = await apiFetchICS(cal.url)
    const events = icsToEvents(text, cal.id, cal.color)
    const ext = safeParse<Record<string, EventRecord[]>>(localStorage.getItem(LS_EXT)) || {}
    ext[cal.id] = events; writeLS(LS_EXT, ext)
    const list = listCalendars().map(c => c.id === cal.id ? { ...c, lastSyncISO: new Date().toISOString() } : c)
    saveCalendars(list)
    return events.length
  }
  return 0
}
export function removeCalendar(id: string) {
  const list = listCalendars().filter(c => c.id !== id); saveCalendars(list)
  const ext = safeParse<Record<string, EventRecord[]>>(localStorage.getItem(LS_EXT)) || {}
  delete ext[id]; writeLS(LS_EXT, ext)
}

// ---- Query helpers ----
function queryMatch(evt: EventRecord, q: string): boolean {
  if (!q) return true
  const hay = [evt.title, evt.location, evt.notes, ...(evt.tags||[])].join(' ').toLowerCase()
  return hay.includes(q.toLowerCase())
}

export function externalExpanded(from: DateTime, to: DateTime, query: string): EventRecord[] {
  const flags = readFlags()
  if (!flags.integrations) return []
  const cals = listCalendars().filter(c => c.enabled)
  if (cals.length === 0) return []
  const ext = safeParse<Record<string, EventRecord[]>>(localStorage.getItem(LS_EXT)) || {}
  const all: EventRecord[] = []
  for (const c of cals) {
    const arr = ext[c.id] || []
    for (const e of arr) if (queryMatch(e, query)) all.push(e)
  }
  return all
}

// For member chips in UI
export function listMembers(): { id: string, name: string }[] {
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS))
  const arr = Array.isArray(s?.members) ? s.members : []
  return arr.map((m:any) => ({ id: m.id, name: m.name }))
}

// Fire a calendar refresh event so calendar views update
;(function bridge(){
  const fire = () => { try { window.dispatchEvent(new Event('fc:events-changed')) } catch {} }
  window.addEventListener('fc:integrations:changed', fire)
  window.addEventListener('storage', (e) => { if (!e) return; if (e.key === LS_INTS || e.key === LS_EXT || e.key === LS_FLAGS) fire() })
})()
