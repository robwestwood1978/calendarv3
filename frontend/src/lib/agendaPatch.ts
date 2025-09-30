// frontend/src/lib/agendaPatch.ts
// Non-invasive "My agenda" filter for fc_events_v1 reads.
// When feature flag is ON, a user is signed in, and settings.myAgendaOnly is true,
// localStorage.getItem('fc_events_v1') returns a filtered JSON string (array) limited
// to events involving the user's linkedMemberIds. Otherwise returns the original.

const LS_EVENTS = 'fc_events_v1'
const LS_SETTINGS = 'fc_settings_v3'
const LS_USERS = 'fc_users_v1'
const LS_CURRENT = 'fc_current_user_v1'
const LS_FLAGS = 'fc_feature_flags_v1'

type AnyRec = Record<string, any>

declare global {
  interface Window {
    __fcOrigGetItem?: Storage['getItem']
  }
}

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function getFlags(): { authEnabled?: boolean } {
  return safeParse(localStorage.getItem(LS_FLAGS)) || { authEnabled: false }
}

function getSettings(): AnyRec {
  const s = safeParse<AnyRec>(localStorage.getItem(LS_SETTINGS)) || {}
  if (!Array.isArray(s.members)) s.members = []
  if (typeof s.myAgendaOnly !== 'boolean') s.myAgendaOnly = false
  return s
}

function getCurrentUser(): AnyRec | null {
  const id = localStorage.getItem(LS_CURRENT)
  const users = safeParse<any[]>(localStorage.getItem(LS_USERS)) || []
  return users.find(u => u.id === id) || null
}

function eventMembers(evt: AnyRec): string[] {
  const a = evt?.attendeeIds || evt?.attendees || evt?.members || []
  const arr = Array.isArray(a) ? a : []
  const extra = [evt?.responsibleId, evt?.responsibleMemberId, evt?.ownerMemberId].filter(Boolean)
  return [...new Set([...arr, ...extra])]
}

function shouldKeep(evt: AnyRec, linked: string[]): boolean {
  if (!Array.isArray(linked) || linked.length === 0) return true // nothing to filter by
  const em = eventMembers(evt)
  return em.some(id => linked.includes(id))
}

function getFilteredEventsJSON(): string {
  const orig = window.__fcOrigGetItem!(LS_EVENTS)
  if (orig == null) return orig as any
  const arr = safeParse<any[]>(orig)
  if (!Array.isArray(arr)) return orig

  const flags = getFlags()
  if (!flags.authEnabled) return orig

  const s = getSettings()
  if (!s.myAgendaOnly) return orig

  const u = getCurrentUser()
  const linked: string[] = u?.linkedMemberIds || []
  if (!u || linked.length === 0) return orig

  const filtered = arr.filter(e => shouldKeep(e, linked))
  try { return JSON.stringify(filtered) } catch { return orig }
}

// Install once
if (!window.__fcOrigGetItem) {
  window.__fcOrigGetItem = localStorage.getItem.bind(localStorage)
  const orig = window.__fcOrigGetItem
  localStorage.getItem = function(key: string): string | null {
    if (key !== LS_EVENTS) return orig(key)
    try { return getFilteredEventsJSON() } catch { return orig(key) }
  }
}

// keep TS happy as a module
export {}
