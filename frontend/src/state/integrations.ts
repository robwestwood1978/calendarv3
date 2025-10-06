// External calendars state (no auto-sync).
import type { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'
import { icsToEvents } from '../utils/ics'
import { fetchICS } from '../api/integrations'

type Provider = 'apple' | 'google' | 'ics'

export type ExternalCalendar = {
  id: string
  provider: Provider
  name: string
  url: string
  color?: string
  enabled: boolean
  lastSyncISO?: string
  assignedMemberIds?: string[]
  allowEditLocal?: boolean // NEW: enable local shadow edits
}

type IntegrationsStore = {
  calendars: ExternalCalendar[]
}

const LS_FLAGS = 'fc_feature_flags_v1'
const LS_INTS  = 'fc_integrations_v1'
const LS_EXT   = 'fc_external_events_v1'
const LS_SETTINGS = 'fc_settings_v3'

type Flags = { integrations?: boolean }

function readFlags(): Flags { try { return JSON.parse(localStorage.getItem(LS_FLAGS) || '{}') } catch { return {} } }
function safeParse<T=any>(raw: string | null): T | null { if (!raw) return null; try { return JSON.parse(raw) as T } catch { return null } }
function writeLS(key: string, val: any) { localStorage.setItem(key, JSON.stringify(val)) }

function readStore(): IntegrationsStore {
  const s = safeParse<IntegrationsStore>(localStorage.getItem(LS_INTS)) || { calendars: [] }
  if (!Array.isArray(s.calendars)) s.calendars = []
  // backfill defaults
  s.calendars = s.calendars.map(c => ({ allowEditLocal: false, ...c }))
  return s
}
function writeStore(next: IntegrationsStore) {
  writeLS(LS_INTS, next)
  try { window.dispatchEvent(new CustomEvent('fc:integrations:changed')) } catch {}
}

export function listCalendars(): ExternalCalendar[] { return readStore().calendars }
export function saveCalendars(next: ExternalCalendar[]) { const s = readStore(); s.calendars = next; writeStore(s) }
export function addCalendar(cal: Omit<ExternalCalendar, 'id'|'enabled'> & { enabled?: boolean }): ExternalCalendar {
  const next: ExternalCalendar = {
    id: `cal_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    enabled: true,
    assignedMemberIds: [],
    allowEditLocal: false,
    ...cal
  }
  const s = readStore(); s.calendars = [...s.calendars, next]; writeStore(s); return next
}
export function updateCalendar(id: string, patch: Partial<ExternalCalendar>) {
  const s = readStore()
  s.calendars = s.calendars.map(c => c.id === id ? { ...c, ...patch } : c)
  writeStore(s)
}
export function removeCalendar(id: string) {
  const s = readStore()
  s.calendars = s.calendars.filter(c => c.id !== id)
  writeStore(s)
  const ext = safeParse<Record<string, EventRecord[]>>(localStorage.getItem(LS_EXT)) || {}
  delete ext[id]; writeLS(LS_EXT, ext)
  try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
}

function queryMatch(evt: EventRecord, q: string): boolean {
  if (!q) return true
  const hay = [evt.title, evt.location, evt.notes, ...(evt.tags||[])].join(' ').toLowerCase()
  return hay.includes(q.toLowerCase())
}

export function externalExpanded(_from: DateTime, _to: DateTime, query: string): EventRecord[] {
  const flags = readFlags()
  if (!flags.integrations) return []
  const cals = listCalendars().filter(c => c.enabled)
  if (cals.length === 0) return []
  const ext = safeParse<Record<string, EventRecord[]>>(localStorage.getItem(LS_EXT)) || {}
  const all: EventRecord[] = []
  for (const c of cals) {
    const arr = ext[c.id] || []
    for (const e of arr) {
      if (queryMatch(e, query)) {
        (e as any)._calendarId = c.id
        ;(e as any)._calendarColor = c.color
        ;(e as any)._calendarName = c.name
        all.push(e)
      }
    }
  }
  return all
}

export async function refreshCalendar(cal: ExternalCalendar): Promise<number> {
  const text = await fetchICS(cal.url)
  const events = icsToEvents(text, cal.id, cal.color)
  const ext = safeParse<Record<string, EventRecord[]>>(localStorage.getItem(LS_EXT)) || {}
  ext[cal.id] = events; writeLS(LS_EXT, ext)
  updateCalendar(cal.id, { lastSyncISO: new Date().toISOString() })
  try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
  return events.length
}

export function listMembers(): { id: string, name: string }[] {
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS))
  const arr = Array.isArray(s?.members) ? s.members : []
  return arr.map((m:any) => ({ id: m.id, name: m.name }))
}
