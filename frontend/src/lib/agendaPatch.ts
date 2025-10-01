// frontend/src/lib/agendaPatch.ts
// Non-invasive "My agenda" filter for fc_events_v1 reads.
// IMPORTANT: Reads toggle from its own key `fc_my_agenda_v1` (never edits fc_settings_v3).

const LS_EVENTS    = 'fc_events_v1'
const LS_SETTINGS  = 'fc_settings_v3'     // read-only (for member name↔id map)
const LS_USERS     = 'fc_users_v1'
const LS_CURRENT   = 'fc_current_user_v1'
const LS_FLAGS     = 'fc_feature_flags_v1'
const LS_MYAGENDA  = 'fc_my_agenda_v1'    // NEW: owns the toggle

type AnyRec = Record<string, any>

declare global {
  interface Window { __fcOrigGetItem?: Storage['getItem'] }
}

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function getFlags(): { authEnabled?: boolean } {
  return safeParse(localStorage.getItem(LS_FLAGS)) || { authEnabled: false }
}

function getMyAgendaOnly(): boolean {
  const v = safeParse<{ on?: boolean }>(localStorage.getItem(LS_MYAGENDA))
  return !!(v && v.on)
}

function getSettingsForMembers(): { members: Array<{id: string; name?: string}> } {
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  const members = Array.isArray(s.members) ? s.members : []
  return { members }
}

function getCurrentUser(): AnyRec | null {
  const id = localStorage.getItem(LS_CURRENT)
  const users = safeParse<any[]>(localStorage.getItem(LS_USERS)) || []
  return users.find(u => u.id === id) || null
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

function normalizeMemberIdsFromEvent(evt: AnyRec, index: { idSet: Set<string>, nameToId: Map<string,string> }): string[] {
  const fields = ['attendeeIds','attendees','members','memberIds','who','whoIds','people','peopleIds','tags']
  const out: string[] = []
  const pushVal = (v: any) => {
    if (v == null) return
    if (Array.isArray(v)) return v.forEach(pushVal)
    if (typeof v === 'string') {
      const s = v.trim(); if (!s) return
      if (index.idSet.has(s)) out.push(s)
      else if (index.nameToId.has(s)) out.push(index.nameToId.get(s)!)
    } else if (typeof v === 'object') {
      const id = v.id || v.memberId
      const name = v.name || v.label
      if (id && index.idSet.has(id)) out.push(id)
      else if (name && index.nameToId.has(name)) out.push(index.nameToId.get(name)!)
    }
  }
  for (const f of fields) pushVal(evt?.[f])
  pushVal(evt?.responsibleId)
  pushVal(evt?.responsibleMemberId)
  pushVal(evt?.responsible)
  pushVal(evt?.ownerMemberId)
  pushVal(evt?.owner)
  return Array.from(new Set(out))
}

function filterEventsJSON(origJSON: string): string {
  const arr = safeParse<any[]>(origJSON)
  if (!Array.isArray(arr)) return origJSON

  if (!getFlags().authEnabled) return origJSON
  if (!getMyAgendaOnly()) return origJSON

  const user = getCurrentUser()
  if (!user) return origJSON

  const linked: string[] = Array.isArray(user.linkedMemberIds) ? user.linkedMemberIds : []

  // With My agenda ON and no linked members -> show NONE
  if (linked.length === 0) return '[]'

  const { members } = getSettingsForMembers()
  const index = buildMemberIndex(members)

  const keep = (evt: AnyRec) => {
    const ids = normalizeMemberIdsFromEvent(evt, index)
    if (ids.length === 0) return false
    return ids.some(id => linked.includes(id))
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
