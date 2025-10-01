// frontend/src/state/events-agenda.ts
// Long-term, reload-free Slice C decorator for your A/B events API.
//
// It preserves the baseline API surface, but:
// - Filters READS (listExpanded) by member NAMES when auth is ON and "My agenda" is ON.
// - Guards WRITES (upsertEvent/deleteEvent): parent=full, adult=linked-only, child=read-only.
// - Emits the same "events changed" signal your app already listens to.
//
// IMPORTANT: We DO NOT write to fc_settings_v3.

import * as base from './events'
import type { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'

// ---- storage keys
const LS_FLAGS     = 'fc_feature_flags_v1'
const LS_USERS     = 'fc_users_v1'
const LS_CURRENT   = 'fc_current_user_v1'
const LS_SETTINGS  = 'fc_settings_v3'   // read-only (members)
const LS_MYAGENDA  = 'fc_my_agenda_v1'
const LS_EVENTS    = 'fc_events_v1'

type AnyRec = Record<string, any>
type UserRole = 'parent' | 'adult' | 'child'

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function fireChanged() {
  try { window.dispatchEvent(new CustomEvent('fc:events:changed')) } catch {}
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

function getMembers(): Array<{ id: string; name: string }> {
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  const raw = Array.isArray(s.members) ? s.members : []
  return raw
    .filter((m: any) => m && typeof m.id === 'string')
    .map((m: any) => ({ id: m.id, name: String(m.name || '').trim() }))
}

// Build *names* list from linkedMemberIds
function linkedMemberNames(): string[] {
  const u = getCurrentUser()
  if (!u) return []
  const members = getMembers()
  const byId = new Map(members.map(m => [m.id, m.name]))
  return u.linkedMemberIds.map(id => (byId.get(id) || '').trim()).filter(Boolean)
}

// True if evt involves any of the linked names (attendees or responsibleAdult)
function evtInvolvesNames(evt: AnyRec, names: string[]): boolean {
  if (!names.length) return false
  const attendees: string[] = Array.isArray(evt.attendees) ? evt.attendees.map((s: any) => String(s || '').trim()) : []
  const resp: string = String((evt as any).responsibleAdult || '').trim()
  // match exact names (case-insensitive)
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

// ---- FILTERED READS (signature EXACTLY matches your baseline)
export function listExpanded(from: DateTime, to: DateTime, query: string): EventRecord[] {
  // Delegate to baseline first (expands recurrences + search query)
  const expanded = base.listExpanded(from, to, query)

  // Gate: only filter when feature flag ON, my agenda ON, and a user exists
  if (!isAuthEnabled()) return expanded
  if (!isMyAgendaOn()) return expanded
  const u = getCurrentUser()
  if (!u) return expanded

  const names = linkedMemberNames()
  if (names.length === 0) return [] // agenda ON + no links => nothing

  // Filter by names on attendees/responsibleAdult
  return expanded.filter(evt => evtInvolvesNames(evt, names))
}

// ---- Re-export other READ helpers unchanged (if your code uses them)
export const list      = (base as any).list      as typeof base.list
export const listRange = (base as any).listRange as typeof base.listRange

// ---- GUARDED WRITES (permissions on top of baseline)

function canWrite(user: ReturnType<typeof getCurrentUser>, before: EventRecord | null, after: EventRecord | null): boolean {
  if (!user) return true
  if (user.role === 'parent') return true
  if (user.role === 'child') return false
  // adult
  const names = linkedMemberNames()
  if (names.length === 0) return false
  if (after && evtInvolvesNames(after, names)) return true
  if (before && evtInvolvesNames(before, names)) return true
  return false
}

function alertOnce(msg: string) { try { alert(msg) } catch {} }

// Preserve baseline signature exactly
export function upsertEvent(evt: EventRecord): EventRecord {
  if (!isAuthEnabled()) return base.upsertEvent(evt)

  const user = getCurrentUser()
  if (!user) return base.upsertEvent(evt)

  if (user.role === 'child') {
    alertOnce('Read-only account: child users cannot change events.')
    return evt
  }
  if (user.role === 'adult') {
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === evt.id) || null
    if (!canWrite(user, before, evt)) {
      alertOnce('You can only change events that involve your linked members.')
      return evt
    }
  }
  const saved = base.upsertEvent(evt)
  fireChanged()
  return saved
}

export function deleteEvent(id: string): void {
  if (!isAuthEnabled()) { base.deleteEvent(id); return }

  const user = getCurrentUser()
  if (!user) { base.deleteEvent(id); return }

  if (user.role === 'child') {
    alertOnce('Read-only account: child users cannot delete events.')
    return
  }
  if (user.role === 'adult') {
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === id) || null
    if (!canWrite(user, before, null)) {
      alertOnce('You can only delete events that involve your linked members.')
      return
    }
  }
  base.deleteEvent(id)
  fireChanged()
}

// ---- Re-export EVERYTHING else from baseline untouched
export * from './events'

// ---- Reactivity bridge: agenda/auth changes should cause views to refresh via the same channel
(function bridge() {
  const fire = () => fireChanged()
  window.addEventListener('fc:users:changed', fire)
  window.addEventListener('fc:settings:changed', fire)
  window.addEventListener('storage', (e) => {
    if (!e) return
    if (e.key === LS_USERS || e.key === LS_CURRENT || e.key === LS_MYAGENDA || e.key === LS_FLAGS) fire()
  })
})()
