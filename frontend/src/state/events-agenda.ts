// frontend/src/state/events-agenda.ts
// Slice C+D decorator for events:
// - Preserves Slice C logic: filtering by linked member *names* and role-based guards.
// - Adds Slice D: overlays external events from integrations (Apple/ICS/etc.).
// - External calendars can be explicitly mapped to members; those events appear in My Agenda.

import * as base from './events'
import type { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'

// ---- LocalStorage keys ----
const LS_FLAGS     = 'fc_feature_flags_v1'
const LS_USERS     = 'fc_users_v1'
const LS_CURRENT   = 'fc_current_user_v1'
const LS_SETTINGS  = 'fc_settings_v3'
const LS_MYAGENDA  = 'fc_my_agenda_v1'
const LS_EVENTS    = 'fc_events_v1'

// ---- Types ----
type UserRole = 'parent' | 'adult' | 'child'
type AnyRec = Record<string, any>

// ---- Helpers ----
function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function featureAuthEnabled(): boolean {
  const f = safeParse<{ authEnabled?: boolean }>(localStorage.getItem(LS_FLAGS))
  return !!(f && f.authEnabled)
}
function myAgendaOn(): boolean {
  const v = safeParse<{ on?: boolean }>(localStorage.getItem(LS_MYAGENDA))
  return !!(v && v.on)
}
function currentUser(): null | { id: string; role: UserRole; linkedMemberIds: string[] } {
  const id = localStorage.getItem(LS_CURRENT)
  if (!id) return null
  const users = safeParse<any[]>(localStorage.getItem(LS_USERS)) || []
  const u = users.find(x => x && x.id === id)
  if (!u) return null
  return { id: u.id, role: u.role as UserRole, linkedMemberIds: Array.isArray(u.linkedMemberIds) ? u.linkedMemberIds : [] }
}

// Resolve linked member IDs to names (for legacy/local events)
function linkedNameCandidates(): string[] {
  const u = currentUser()
  if (!u) return []
  const ids = Array.isArray(u.linkedMemberIds) ? u.linkedMemberIds : []
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  const out: string[] = []

  if (Array.isArray(s.members)) {
    const byId = new Map<string, string>()
    for (const m of s.members) {
      if (m && typeof m.id === 'string') byId.set(m.id, String(m.name || '').trim())
    }
    for (const id of ids) {
      const name = (byId.get(id) || '').trim()
      if (name) out.push(name)
    }
    if (out.length) return out
  }

  if (s && s.memberLookup && typeof s.memberLookup === 'object') {
    for (const id of ids) {
      const name = String(s.memberLookup[id] || '').trim()
      if (name) out.push(name)
    }
    if (out.length) return out
  }

  return ids.map(v => String(v || '').trim()).filter(Boolean)
}

function evtInvolvesNames(evt: AnyRec, names: string[]): boolean {
  if (!names.length) return false
  const canon = (s: string) => String(s || '').trim().toLowerCase()
  const set = new Set((Array.isArray(evt.attendees) ? evt.attendees : []).map(canon))
  const ra = canon((evt as any).responsibleAdult || '')
  for (const n of names) {
    const c = canon(n)
    if (set.has(c)) return true
    if (ra && ra === c) return true
  }
  return false
}

function emitChanged() { try { window.dispatchEvent(new CustomEvent('fc:events:changed')) } catch {} }
function toast(msg: string) { try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {} }

// ---- External overlays (Slice D) ----
import { externalExpanded, listCalendars } from './integrations'

// ---------- FILTERED READS ----------
export function listExpanded(from: DateTime, to: DateTime, query: string): EventRecord[] {
  const local = base.listExpanded(from, to, query)
  let ext: EventRecord[] = []
  try { ext = externalExpanded(from, to, query) } catch { ext = [] }

  let merged = [...local, ...ext]

  if (!featureAuthEnabled()) return merged
  if (!myAgendaOn()) return merged

  const u = currentUser()
  if (!u) return merged
  const linkedIds = new Set<string>((u.linkedMemberIds || []) as string[])

  const names = linkedNameCandidates()
  const localsFiltered = merged.filter(evt => evtInvolvesNames(evt, names))

  // External: include if calendar is mapped to a linked member
  const extCalMap = new Map(listCalendars().map(c => [c.id, new Set(c.assignedMemberIds || [])]))
  const externalsMapped = merged.filter(evt => {
    const id = (evt as any)._calendarId as string | undefined
    if (!id) return false
    const set = extCalMap.get(id); if (!set) return false
    for (const m of set) if (linkedIds.has(m)) return true
    return false
  })

  const out: EventRecord[] = []
  const seen = new Set<string>()
  for (const e of [...localsFiltered, ...externalsMapped]) {
    if (seen.has(e.id)) continue
    seen.add(e.id); out.push(e)
  }
  return out
}

// Re-export read helpers
export const list      = (base as any).list      as typeof base.list
export const listRange = (base as any).listRange as typeof base.listRange

// ---------- GUARDED WRITES ----------
function canWrite(u: ReturnType<typeof currentUser>, before: EventRecord | null, after: EventRecord | null): boolean {
  if (!u) return true
  if (u.role === 'parent') return true
  if (u.role === 'child') return false
  const names = linkedNameCandidates()
  if (names.length === 0) return false
  if (after && evtInvolvesNames(after, names)) return true
  if (before && evtInvolvesNames(before, names)) return true
  return false
}

export function upsertEvent(evt: EventRecord): EventRecord {
  if (!featureAuthEnabled()) return base.upsertEvent(evt)
  const u = currentUser()
  if (!u) return base.upsertEvent(evt)

  if (u.role === 'child') { toast('Children cannot change events.'); return evt }
  if (u.role === 'adult') {
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === evt.id) || null
    if (!canWrite(u, before, evt)) { toast('You can only change events that involve your linked members.'); return evt }
  }
  const saved = base.upsertEvent(evt)
  emitChanged()
  return saved
}

export function deleteEvent(id: string): void {
  if (!featureAuthEnabled()) { base.deleteEvent(id); return }
  const u = currentUser()
  if (!u) { base.deleteEvent(id); return }

  if (u.role === 'child') { toast('Children cannot delete events.'); return }
  if (u.role === 'adult') {
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === id) || null
    if (!canWrite(u, before, null)) { toast('You can only delete events that involve your linked members.'); return }
  }
  base.deleteEvent(id)
  emitChanged()
}

// Re-export everything else unchanged
export * from './events'

// Reactive bridge
;(function bridge() {
  const fire = () => emitChanged()
  window.addEventListener('fc:users:changed', fire)
  window.addEventListener('fc:settings:changed', fire)
  window.addEventListener('fc:integrations:changed', fire)
  window.addEventListener('storage', (e) => {
    if (!e) return
    if (e.key === LS_USERS || e.key === LS_CURRENT || e.key === LS_MYAGENDA || e.key === LS_FLAGS) fire()
  })
})()
