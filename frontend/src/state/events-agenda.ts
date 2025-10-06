import * as base from './events'
import type { DateTime } from 'luxon'
import { DateTime as Lx } from 'luxon'
import type { EventRecord } from '../lib/recurrence'
import { externalExpanded, listCalendars } from './integrations'
import { isExternal, toExtKey } from '../lib/external'

const LS_FLAGS     = 'fc_feature_flags_v1'
const LS_USERS     = 'fc_users_v1'
const LS_CURRENT   = 'fc_current_user_v1'
const LS_SETTINGS  = 'fc_settings_v3'
const LS_MYAGENDA  = 'fc_my_agenda_v1'
const LS_EVENTS    = 'fc_events_v1'
const LS_SHADOWS   = 'fc_shadow_events_v1'

type UserRole = 'parent' | 'adult' | 'child'
type AnyRec = Record<string, any>

function safeParse<T = any>(raw: string | null): T | null { if (!raw) return null; try { return JSON.parse(raw) as T } catch { return null } }
function emitChanged() { try { window.dispatchEvent(new CustomEvent('fc:events-changed')) } catch {} }
function toast(msg: string) { try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {} }

function featureAuthEnabled(): boolean { const f = safeParse<any>(localStorage.getItem(LS_FLAGS)); return !!(f && f.authEnabled) }
function myAgendaOn(): boolean { const v = safeParse<any>(localStorage.getItem(LS_MYAGENDA)); return typeof v === 'boolean' ? v : !!(v && v.on) }
function currentUser(): null | { id: string; role: UserRole; linkedMemberIds: string[] } {
  const id = localStorage.getItem(LS_CURRENT)
  if (!id) return null
  const users = safeParse<any[]>(localStorage.getItem(LS_USERS)) || []
  const u = users.find(x => x && x.id === id)
  if (!u) return null
  return { id: u.id, role: u.role as UserRole, linkedMemberIds: Array.isArray(u.linkedMemberIds) ? u.linkedMemberIds : [] }
}
function linkedNameCandidates(): string[] {
  const u = currentUser(); if (!u) return []
  const ids = Array.isArray(u.linkedMemberIds) ? u.linkedMemberIds : []
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  const out: string[] = []
  if (Array.isArray(s.members)) {
    const byId = new Map<string, string>()
    for (const m of s.members) if (m && typeof m.id === 'string') byId.set(m.id, String(m.name || '').trim())
    for (const id of ids) { const name = (byId.get(id) || '').trim(); if (name) out.push(name) }
    if (out.length) return out
  }
  if (s && s.memberLookup && typeof s.memberLookup === 'object') {
    for (const id of ids) { const name = String(s.memberLookup[id] || '').trim(); if (name) out.push(name) }
    if (out.length) return out
  }
  return ids.map(v => String(v || '').trim()).filter(Boolean)
}
function evtInvolvesNames(evt: AnyRec, names: string[]): boolean {
  if (!names.length) return false
  const canon = (s: string) => String(s || '').trim().toLowerCase()
  const set = new Set((Array.isArray(evt.attendees) ? evt.attendees : []).map(canon))
  const ra = canon((evt as any).responsibleAdult || '')
  for (const n of names) { const c = canon(n); if (set.has(c) || (ra && ra === c)) return true }
  return false
}
function overlaps(evt: EventRecord, from: DateTime, to: DateTime): boolean {
  const s = Lx.fromISO(evt.start); const e = Lx.fromISO(evt.end)
  if (!s.isValid || !e.isValid) return false
  return s <= to && e >= from
}

// ---- Shadows (local overlays for external instances) ----
type Shadow = EventRecord & { source: 'shadow', extKey: string, shadowOf: string, shadowAt: string }
function readShadows(): Shadow[] { return safeParse<Shadow[]>(localStorage.getItem(LS_SHADOWS)) || [] }
function writeShadows(arr: Shadow[]) { localStorage.setItem(LS_SHADOWS, JSON.stringify(arr)); emitChanged() }
function shadowMap(): Map<string, Shadow> { const map = new Map<string, Shadow>(); for (const s of readShadows()) map.set(s.extKey, s); return map }

// ---------- FILTERED READS ----------
export function listExpanded(from: DateTime, to: DateTime, query: string): EventRecord[] {
  const locals = (base.listExpanded(from, to, query) as EventRecord[]).filter(e => overlaps(e, from, to))
  let externals: EventRecord[] = []
  try { externals = externalExpanded(from, to, query).filter(e => overlaps(e, from, to)) } catch { externals = [] }

  // Replace external instances with shadows when present
  const sMap = shadowMap()
  const withShadows = externals.map(e => {
    const key = toExtKey(e)
    return (key && sMap.has(key)) ? sMap.get(key)! as EventRecord : e
  })

  // My Agenda OFF → union locals + externals/shadows, de-dupe by (id,start)
  if (!featureAuthEnabled() || !myAgendaOn()) {
    const out: EventRecord[] = []
    const seen = new Set<string>()
    for (const e of [...locals, ...withShadows]) {
      const key = `${e.id}@@${e.start}`
      if (seen.has(key)) continue
      seen.add(key); out.push(e)
    }
    return out
  }

  // My Agenda ON → locals by linked names + externals mapped to linked members
  const u = currentUser()
  const linkedIds = new Set<string>(u?.linkedMemberIds || [])
  const names = linkedNameCandidates()

  const localsFiltered = locals.filter(evt => evtInvolvesNames(evt, names))

  const calMap = new Map(listCalendars().map(c => [c.id, new Set(c.assignedMemberIds || [])]))
  const externalsFiltered = withShadows.filter(evt => {
    const id = (evt as any)._calendarId as string | undefined
    if (!id) return false
    const set = calMap.get(id); if (!set) return false
    for (const m of set) if (linkedIds.has(m)) return true
    return false
  })

  const out: EventRecord[] = []
  const seen = new Set<string>()
  for (const e of [...localsFiltered, ...externalsFiltered]) {
    const key = `${e.id}@@${e.start}`
    if (seen.has(key)) continue
    seen.add(key); out.push(e)
  }
  return out
}

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

export function upsertEvent(evt: EventRecord, scope?: 'single'|'following'|'series'): EventRecord {
  // External edits → only when allowEditLocal=true for that calendar; otherwise block (prevents dupes)
  if (isExternal(evt)) {
    const calId = (evt as any)._calendarId as string | undefined
    const cal = calId ? listCalendars().find(c => c.id === calId) : undefined
    if (!cal || !cal.allowEditLocal) {
      toast('This event is from an external calendar. Enable “Allow editing (local)” in Integrations to edit it.')
      return evt
    }
    const key = toExtKey(evt)
    if (key) {
      const shadows = readShadows()
      const baseShadow: Shadow = { ...(evt as any), source: 'shadow', extKey: key, shadowOf: String(evt.id), shadowAt: new Date().toISOString() }
      const idx = shadows.findIndex(s => s.extKey === key)
      if (idx >= 0) shadows[idx] = baseShadow; else shadows.push(baseShadow)
      writeShadows(shadows)
      return evt
    }
  }

  // Local edits (and all non-external) → baseline with Slice C guards
  if (!featureAuthEnabled()) { const saved = (base as any).upsertEvent(evt, scope); emitChanged(); return saved }
  const u = currentUser()
  if (!u) { const saved = (base as any).upsertEvent(evt, scope); emitChanged(); return saved }

  if (u.role === 'child') { toast('Children cannot change events.'); return evt }
  if (u.role === 'adult') {
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === evt.id) || null
    if (!canWrite(u, before, evt)) { toast('You can only change events that involve your linked members.'); return evt }
  }
  const saved = (base as any).upsertEvent(evt, scope); emitChanged(); return saved
}

export function deleteEvent(id: string): void {
  // Shadow delete = revert local edit
  const shadows = readShadows()
  const idx = shadows.findIndex(s => s.id === id || s.shadowOf === id)
  if (idx >= 0) { shadows.splice(idx, 1); writeShadows(shadows); return }

  if (!featureAuthEnabled()) { (base as any).deleteEvent(id); emitChanged(); return }
  const u = currentUser()
  if (!u) { (base as any).deleteEvent(id); emitChanged(); return }

  if (u.role === 'child') { toast('Children cannot delete events.'); return }
  if (u.role === 'adult') {
    const all = safeParse<EventRecord[]>(localStorage.getItem(LS_EVENTS)) || []
    const before = all.find(e => e && e.id === id) || null
    if (!canWrite(u, before, null)) { toast('You can only delete events that involve your linked members.'); return }
  }
  (base as any).deleteEvent(id); emitChanged()
}

export const list      = (base as any).list      as typeof base.list
export const listRange = (base as any).listRange as typeof base.listRange
export * from './events'

// Reactive bridge
;(function bridge() {
  const fire = () => emitChanged()
  window.addEventListener('fc:users:changed', fire)
  window.addEventListener('fc:settings:changed', fire)
  window.addEventListener('fc:integrations:changed', fire)
  window.addEventListener('fc:my-agenda:changed', fire)
  window.addEventListener('storage', (e) => {
    if (!e) return
    if (e.key === LS_USERS || e.key === LS_CURRENT || e.key === LS_MYAGENDA || e.key === LS_FLAGS || e.key === LS_SHADOWS) fire()
  })
})()
