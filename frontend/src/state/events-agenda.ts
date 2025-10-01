// frontend/src/state/events-agenda.ts
// Slice C decorator for events: filters reads by linked *names* and guards writes.
// Robust against missing settings.members. No writes to fc_settings_v3.

import * as base from './events'
import type { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'

// LocalStorage keys
const LS_FLAGS     = 'fc_feature_flags_v1'
const LS_USERS     = 'fc_users_v1'
const LS_CURRENT   = 'fc_current_user_v1'
const LS_SETTINGS  = 'fc_settings_v3'
const LS_MYAGENDA  = 'fc_my_agenda_v1'
const LS_EVENTS    = 'fc_events_v1'

type AnyRec = Record<string, any>
type UserRole = 'parent' | 'adult' | 'child'

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function isAuthEnabled(): boolean {
  const f = safeParse<{ authEnabled?: boolean }>(localStorage.getItem(LS_FLAGS))
  return !!(f && f.authEnabled)
}
function isMyAgendaOn(): boolean {
  const v = safeParse<{ on?: boolean }>(localStorage.getItem(LS_MYAGENDA))
  return !!(v && v.on)
}
function getCurrentUser(): null | { id: string; role: UserRole; linkedMemberIds: string[] } {
  const id = localStorage.getItem(LS_CURRENT)
  if (!id) return null
  const users = safeParse<any[]>(localStorage.getItem(LS_USERS)) || []
  const u = users.find(x => x && x.id === id)
  if (!u) return null
  return { id: u.id, role: u.role as UserRole, linkedMemberIds: Array.isArray(u.linkedMemberIds) ? u.linkedMemberIds : [] }
}

// Resolve ID→name using multiple shapes; return [] if nothing resolvable
function resolveNamesFromSettings(ids: string[]): string[] {
  if (ids.length === 0) return []
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  const out: string[] = []

  // Shape A: settings.members: Array<{id,name}>
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

  // Shape B: settings.memberLookup: { [id]: name }
  if (s && s.memberLookup && typeof s.memberLookup === 'object') {
    for (const id of ids) {
      const name = String(s.memberLookup[id] || '').trim()
      if (name) out.push(name)
    }
    if (out.length) return out
  }

  return out
}

// Build candidate names for matching. If we can’t resolve IDs to names,
// fall back to treating the ids themselves as names (keeps legacy name-linking workable).
function linkedNameCandidates(): string[] {
  const u = getCurrentUser()
  if (!u) return []
  const names = resolveNamesFromSettings(u.linkedMemberIds)
  if (names.length > 0) return names
  // Fallback: allow linking by name directly (ids array may actually contain names in some datasets)
  return u.linkedMemberIds.map(s => String(s || '').trim()).filter(Boolean)
}

// Exact name match against attendees[] and responsibleAdult
function evtInvolvesNames(evt: AnyRec, names: string[]): boolean {
  if (!names.length) return false
  const attendees: string[] = Array.isArray(evt.attendees) ? evt.attendees.map((s:any)=>String(s||'').trim()) : []
  const resp: string = String((evt as any).responsibleAdult || '').trim()
  const canon = (s: string) => s.toLowerCase()
  const attSet = new Set(attendees.map(canon))
  const respC = canon(resp)
  for (const n of names) {
    const nc = canon(n)
    if (attSet.has(nc)) return true
    if (respC && respC === nc) return true
  }
  return false
}

function fireChanged() { try { window.dispatchEvent(new CustomEvent('fc:events:changed')) } catch {} }

// ---- FILTERED READS (signature EXACTLY matches baseline)
export function listExpanded(from: DateTime, to: DateTime, query: string): EventRecord[] {
  const expanded = base.listExpanded(from, to, query)

  if (!isAuthEnabled()) return expanded
  if (!isMyAgendaOn()) return expanded
  const user = getCurrentUser()
  if (!user) return expanded

  const names = linkedNameCandidates()
  if (names.length === 0) return [] // agenda ON + no links: show nothing

  return expanded.filter(evt => evtInvolvesNames(evt, names))
}

// Re-export other read helpers unchanged
export const list      = (base as any).list      as typeof base.list
export const listRange = (base as any).listRange as typeof base.listRange

// ---- GUARDED WRITES (permissions)
function canWrite(user: ReturnType<typeof getCurrentUser>, before: EventRecord | null, after: EventRecord | null): boolean {
  if (!user) return true
  if (user.role === 'parent') return true
  if (user.role === 'child') return false
  const names = linkedNameCandidates()
  if (names.length === 0) return false
  if (after && evtInvolvesNames(after, names)) return true
  if (before && evtInvolvesNames(before, names)) return true
  return false
}
function alertOnce(msg: string) { try { alert(msg) } catch {} }

export function upsertEvent(evt: EventRecord): EventRecord {
  if (!isAuthEnabled()) return base.upsertEvent(evt)
  const user = getCurrentUser()
  if (!user) return base.upsertEvent(evt)
  if (user.role === 'child') { alertOnce('Read-only account: child users cannot change events.'); return evt }
  if (user.role === 'adult') {
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === evt.id) || null
    if (!canWrite(user, before, evt)) { alertOnce('You can only change events that involve your linked members.'); return evt }
  }
  const saved = base.upsertEvent(evt)
  fireChanged()
  return saved
}

export function deleteEvent(id: string): void {
  if (!isAuthEnabled()) { base.deleteEvent(id); return }
  const user = getCurrentUser()
  if (!user) { base.deleteEvent(id); return }
  if (user.role === 'child') { alertOnce('Read-only account: child users cannot delete events.'); return }
  if (user.role === 'adult') {
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === id) || null
    if (!canWrite(user, before, null)) { alertOnce('You can only delete events that involve your linked members.'); return }
  }
  base.deleteEvent(id)
  fireChanged()
}

// Re-export everything else from baseline untouched
export * from './events'

// Reactivity bridge: when agenda/auth/flags change, tell views to refresh via existing channel
;(function bridge() {
  const fire = () => fireChanged()
  window.addEventListener('fc:users:changed', fire)
  window.addEventListener('fc:settings:changed', fire)
  window.addEventListener('storage', (e) => {
    if (!e) return
    if (e.key === LS_USERS || e.key === LS_CURRENT || e.key === LS_MYAGENDA || e.key === LS_FLAGS) fire()
  })
})()
