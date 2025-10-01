// frontend/src/state/events-agenda.ts
// Long-term, reload-free Slice C decorator.
// Re-exports baseline events API but filters reads for "My agenda"
// and guards writes for permissions — only when the feature flag is ON.
//
// With the flag OFF: 100% baseline behaviour.
//
// NOTE: We don't touch fc_settings_v3. We only *read* members from it
// to map names<->ids. "My agenda" state lives in fc_my_agenda_v1.

import * as base from './events'
import type { EventRecord } from '../lib/recurrence'

// ---- Storage keys (read-only except events writes via base API)
const LS_FLAGS     = 'fc_feature_flags_v1'
const LS_USERS     = 'fc_users_v1'
const LS_CURRENT   = 'fc_current_user_v1'
const LS_SETTINGS  = 'fc_settings_v3'      // read-only; we never mutate
const LS_MYAGENDA  = 'fc_my_agenda_v1'     // { on: boolean }
const LS_EVENTS    = 'fc_events_v1'

// ---- Small helpers

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

function getCurrentUser(): null | {
  id: string
  role: UserRole
  linkedMemberIds: string[]
} {
  const id = localStorage.getItem(LS_CURRENT)
  if (!id) return null
  const users = safeParse<any[]>(localStorage.getItem(LS_USERS)) || []
  const u = users.find(x => x && x.id === id)
  if (!u) return null
  return {
    id: u.id,
    role: u.role as UserRole,
    linkedMemberIds: Array.isArray(u.linkedMemberIds) ? u.linkedMemberIds : [],
  }
}

function getMembers(): Array<{ id: string; name?: string }> {
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  return Array.isArray(s.members) ? s.members : []
}

function buildMemberIndex(members: Array<{ id: string; name?: string }>, linkedIds: string[]) {
  const linkedIdSet = new Set<string>(linkedIds)
  const canonicalNameById = new Map<string, string>()
  for (const m of members) {
    if (!m?.id) continue
    canonicalNameById.set(m.id, (m.name || '').trim().toLowerCase())
  }
  const linkedNamesCanonical = linkedIds
    .map(id => canonicalNameById.get(id) || '')
    .filter(Boolean)
  return { linkedIdSet, linkedNamesCanonical }
}

function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function eventMatchesLinked(evt: AnyRec, linkedIdSet: Set<string>, linkedNamesCanonical: string[]): boolean {
  let found = false
  const visit = (v: any) => {
    if (found || v == null) return
    const t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') {
      const s = String(v).trim(); if (!s) return
      if (linkedIdSet.has(s)) { found = true; return }
      const sc = s.toLowerCase()
      for (const name of linkedNamesCanonical) {
        if (!name) continue
        const re = new RegExp(`(^|\\b|\\s)${escapeRegExp(name)}(\\b|\\s|$)`)
        if (re.test(sc)) { found = true; return }
      }
      return
    }
    if (Array.isArray(v)) { for (const x of v) { visit(x); if (found) return } return }
    if (t === 'object')     { for (const k in v) { visit(v[k]); if (found) return } return }
  }
  visit(evt)
  return found
}

function shouldFilter(): { on: boolean; user: ReturnType<typeof getCurrentUser> } {
  if (!isAuthEnabled()) return { on: false, user: null }
  const on = isMyAgendaOn()
  if (!on) return { on: false, user: null }
  const user = getCurrentUser()
  if (!user) return { on: false, user: null }
  return { on: true, user }
}

// ---- FILTERED READS

// Keep type/signature identical to baseline listExpanded(...)
export function listExpanded(
  fromISO: string,
  toISO: string,
  allEvents: EventRecord[]
): EventRecord[] {
  // Delegate to baseline first (it expands recurrences etc.)
  const expanded = base.listExpanded(fromISO, toISO, allEvents)

  const gate = shouldFilter()
  if (!gate.on) return expanded

  const { user } = gate
  const linked = user!.linkedMemberIds || []
  if (linked.length === 0) return [] // My agenda ON + no links => nothing

  const members = getMembers()
  const { linkedIdSet, linkedNamesCanonical } = buildMemberIndex(members, linked)

  // Schema-agnostic: deep scan for any linked id or linked name token.
  return expanded.filter(evt => eventMatchesLinked(evt, linkedIdSet, linkedNamesCanonical))
}

// Re-export any other read helpers unchanged
export const list = (base as any).list as typeof base.list
export const listRange = (base as any).listRange as typeof base.listRange

// ---- GUARDED WRITES (permissions). If you want to defer permissions, you can keep base.* unmodified.

function intersectsLinked(evt: AnyRec, linkedIdSet: Set<string>, linkedNamesCanonical: string[]): boolean {
  return eventMatchesLinked(evt, linkedIdSet, linkedNamesCanonical)
}

function canWrite(user: ReturnType<typeof getCurrentUser>, before: EventRecord | null, after: EventRecord | null): boolean {
  if (!user) return true // treat as baseline if no user (flag gate should prevent this)
  if (user.role === 'parent') return true
  if (user.role === 'child') return false

  // adult: only write if the affected event intersects linked members
  const linked = user.linkedMemberIds || []
  if (linked.length === 0) return false
  const { linkedIdSet, linkedNamesCanonical } = buildMemberIndex(getMembers(), linked)

  if (after && intersectsLinked(after, linkedIdSet, linkedNamesCanonical)) return true
  if (before && intersectsLinked(before, linkedIdSet, linkedNamesCanonical)) return true
  return false
}

function alertOnce(msg: string) {
  try { alert(msg) } catch {}
}

// upsertEvent(event) -> EventRecord (baseline signature preserved)
export function upsertEvent(ev: EventRecord): EventRecord {
  if (!isAuthEnabled()) return base.upsertEvent(ev)

  const user = getCurrentUser()
  if (!user) return base.upsertEvent(ev)

  if (user.role === 'child') {
    alertOnce('Read-only account: child users cannot change events.')
    return ev // no-op; baseline components stay stable
  }

  if (user.role === 'adult') {
    // find "before" if it exists
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === ev.id) || null
    if (!canWrite(user, before, ev)) {
      alertOnce('You can only change events that involve your linked members.')
      return ev
    }
  }

  const saved = base.upsertEvent(ev)
  // Announce change (baseline usually already does this; extra is harmless)
  try { window.dispatchEvent(new CustomEvent('fc:events:changed')) } catch {}
  return saved
}

// deleteEvent(id) -> void (baseline signature preserved)
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
  try { window.dispatchEvent(new CustomEvent('fc:events:changed')) } catch {}
}

// ---- Re-export *everything else* from baseline, untouched.
// This ensures pages/components that import other helpers continue to work.
export * from './events'

// ---- Reactivity bridge:
// Home/Calendar already refresh when the baseline events store announces changes.
// We forward relevant changes (auth toggle, link/unlink, my-agenda toggle) into that same channel.

function bridgeToEventsChanged() {
  const fire = () => { try { window.dispatchEvent(new CustomEvent('fc:events:changed')) } catch {} }

  // When users list or current user changes (AuthProvider emits fc:users:changed)
  window.addEventListener('fc:users:changed', fire)

  // When settings-like things change for agenda (we emit fc:settings:changed from toggles)
  window.addEventListener('fc:settings:changed', fire)

  // Cross-tab/local changes
  window.addEventListener('storage', (e) => {
    if (!e) return
    if (e.key === LS_USERS || e.key === LS_CURRENT || e.key === LS_MYAGENDA || e.key === LS_FLAGS) fire()
  })
}

// install once
try { bridgeToEventsChanged() } catch {}
