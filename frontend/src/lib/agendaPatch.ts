// frontend/src/lib/agendaPatch.ts
// Non-invasive "My agenda" filter for fc_events_v1 reads.
// Now handles empty linked members (-> show none), broader membership fields, and name→ID mapping.

const LS_EVENTS   = 'fc_events_v1'
const LS_SETTINGS = 'fc_settings_v3'
const LS_USERS    = 'fc_users_v1'
const LS_CURRENT  = 'fc_current_user_v1'
const LS_FLAGS    = 'fc_feature_flags_v1'

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

function getSettings(): { members: Array<{id: string; name?: string}>; myAgendaOnly: boolean } {
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  const members = Array.isArray(s.members) ? s.members : []
  const myAgendaOnly = !!s.myAgendaOnly
  return { members, myAgendaOnly }
}

function getCurrentUser(): AnyRec | null {
  const id = localStorage.getItem(LS_CURRENT)
  const users = safeParse<any[]>(localStorage.getItem(LS_USERS)) || []
  return users.find(u => u.id === id) || null
}

function normalizeMemberIdsFromEvent(evt: AnyRec, memberIndex: { idSet: Set<string>, nameToId: Map<string,string> }): string[] {
  const fields = [
    'attendeeIds','attendees','members','memberIds','who','whoIds','people','peopleIds','tags'
  ]
  const out: string[] = []

  const pushVal = (v: any) => {
    if (!v && v !== 0) return
    if (typeof v === 'string') {
      const s = v.trim()
      if (!s) return
      if (memberIndex.idSet.has(s)) out.push(s)
      else if (memberIndex.nameToId.has(s)) out.push(memberIndex.nameToId.get(s)!)
    } else if (typeof v === 'object') {
      // objects like { id: 'm_...' , name: 'Rob' }
      const id = (v && (v.id || v.memberId)) as string | undefined
      const name = (v && (v.name || v.label)) as string | undefined
      if (id && memberIndex.idSet.has(id)) out.push(id)
      else if (name && memberIndex.nameToId.has(name)) out.push(memberIndex.nameToId.get(name)!)
    } else if (Array.isArray(v)) {
      v.forEach(pushVal)
    }
  }

  for (const f of fields) pushVal(evt?.[f])

  // responsible/owner (could be id or name)
  pushVal(evt?.responsibleId)
  pushVal(evt?.responsibleMemberId)
  pushVal(evt?.responsible)
  pushVal(evt?.ownerMemberId)
  pushVal(evt?.owner)

  // unique
  return Array.from(new Set(out))
}

function buildMemberIndex(members: Array<{id: string; name?: string}>) {
  const idSet = new Set<string>()
  const nameToId = new Map<string, string>()
  for (const m of members || []) {
    if (m?.id) idSet.add(m.id)
    if (m?.name) nameToId.set(m.name, m.id)
  }
  return { idSet, nameToId }
}

function filterEventsJSON(origJSON: string): string {
  const arr = safeParse<any[]>(origJSON)
  if (!Array.isArray(arr)) return origJSON

  const flags = getFlags()
  if (!flags.authEnabled) return origJSON

  const { members, myAgendaOnly } = getSettings()
  if (!myAgendaOnly) return origJSON

  const user = getCurrentUser()
  if (!user) return origJSON

  const linked: string[] = Array.isArray(user.linkedMemberIds) ? user.linkedMemberIds : []

  // IMPORTANT CHANGE: if My agenda is ON but user has no linked members → show NONE
  if (linked.length === 0) {
    try { return JSON.stringify([]) } catch { return '[]' }
  }

  const index = buildMemberIndex(members)

  const keep = (evt: AnyRec) => {
    const ids = normalizeMemberIdsFromEvent(evt, index)
    if (ids.length === 0) return false
    for (const id of ids) if (linked.includes(id)) return true
    return false
  }

  const filtered = arr.filter(keep)
  try { return JSON.stringify(filtered) } catch { return origJSON }
}

// Install once
if (!window.__fcOrigGetItem) {
  window.__fcOrigGetItem = localStorage.getItem.bind(localStorage)
  const orig = window.__fcOrigGetItem
  localStorage.getItem = function(key: string): string | null {
    if (key !== LS_EVENTS) return orig(key)
    try {
      const origJSON = orig(key)
      if (origJSON == null) return origJSON
      return filterEventsJSON(origJSON)
    } catch {
      return orig(key)
    }
  }
}

export {}
