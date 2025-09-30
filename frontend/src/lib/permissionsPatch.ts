// frontend/src/lib/permissionsPatch.ts
// Non-invasive permissions guard for fc_events_v1 writes.
// Parent: full access. Adult: may add/edit/delete only events involving linkedMemberIds.
// Child: read-only (blocks writes).
// If a write is blocked, we show a small alert and NO-OP.

const LS_EVENTS = 'fc_events_v1'
const LS_USERS = 'fc_users_v1'
const LS_CURRENT = 'fc_current_user_v1'
const LS_FLAGS = 'fc_feature_flags_v1'

type AnyRec = Record<string, any>

declare global {
  interface Window {
    __fcOrigSetItem?: Storage['setItem']
  }
}

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function getFlags(): { authEnabled?: boolean } {
  return safeParse(localStorage.getItem(LS_FLAGS)) || { authEnabled: false }
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

function byId(list: AnyRec[]): Record<string, AnyRec> {
  const map: Record<string, AnyRec> = {}
  for (const e of list) if (e && e.id) map[e.id] = e
  return map
}

function intersects(a: string[], b: string[]) {
  const set = new Set(a)
  return b.some(x => set.has(x))
}

function canAdultWrite(prev: AnyRec[], next: AnyRec[], linked: string[]): boolean {
  const A = byId(prev)
  const B = byId(next)

  const prevIds = new Set(Object.keys(A))
  const nextIds = new Set(Object.keys(B))

  // additions
  for (const id of nextIds) {
    if (!prevIds.has(id)) {
      const e = B[id]
      if (!intersects(eventMembers(e), linked)) return false
    }
  }
  // edits
  for (const id of nextIds) {
    if (prevIds.has(id)) {
      const before = A[id]
      const after = B[id]
      // if the event changes, ensure it involves linked members
      const changed = JSON.stringify(before) !== JSON.stringify(after)
      if (changed && !intersects(eventMembers(after), linked)) return false
    }
  }
  // deletions
  for (const id of prevIds) {
    if (!nextIds.has(id)) {
      const e = A[id]
      if (!intersects(eventMembers(e), linked)) return false
    }
  }
  return true
}

// Install once
if (!window.__fcOrigSetItem) {
  window.__fcOrigSetItem = localStorage.setItem.bind(localStorage)
  const orig = window.__fcOrigSetItem
  localStorage.setItem = function(key: string, value: string): void {
    if (key !== LS_EVENTS) {
      return orig(key, value)
    }
    try {
      const flags = getFlags()
      if (!flags.authEnabled) return orig(key, value)

      const user = getCurrentUser()
      if (!user) return orig(key, value)

      const prev = safeParse<any[]>(localStorage.getItem(LS_EVENTS)) || []
      const next = safeParse<any[]>(value) || []

      if (user.role === 'parent') {
        return orig(key, value)
      }
      if (user.role === 'child') {
        alert('Read-only account: changes are not allowed for child users.')
        return // block write
      }
      // adult
      const linked: string[] = Array.isArray(user.linkedMemberIds) ? user.linkedMemberIds : []
      if (canAdultWrite(prev, next, linked)) {
        return orig(key, value)
      } else {
        alert('You can only change events that involve your linked members.')
        return // block write
      }
    } catch {
      return orig(key, value) // fail open
    }
  }
}

export {}
