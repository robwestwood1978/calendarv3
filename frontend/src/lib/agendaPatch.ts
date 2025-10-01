// frontend/src/lib/agendaPatch.ts
// Schema-agnostic "My agenda" filter for fc_events_v1 reads.
// - Reads toggle from fc_my_agenda_v1 (never mutates fc_settings_v3).
// - Matches linked members by ID OR name anywhere inside an event (deep scan, case-insensitive).
// - If My agenda = ON and linkedMemberIds = [], returns [] (show nothing).

const LS_EVENTS    = 'fc_events_v1'
const LS_SETTINGS  = 'fc_settings_v3'     // READ-ONLY (for members list)
const LS_USERS     = 'fc_users_v1'
const LS_CURRENT   = 'fc_current_user_v1'
const LS_FLAGS     = 'fc_feature_flags_v1'
const LS_MYAGENDA  = 'fc_my_agenda_v1'

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

function getCurrentUser(): AnyRec | null {
  const id = localStorage.getItem(LS_CURRENT)
  const users = safeParse<any[]>(localStorage.getItem(LS_USERS)) || []
  return users.find(u => u.id === id) || null
}

function getMembers(): Array<{ id: string; name?: string }> {
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  return Array.isArray(s.members) ? s.members : []
}

/** Build lookups for matching */
function buildMemberLookups(members: Array<{ id: string; name?: string }>, linkedIds: string[]) {
  const linkedIdSet = new Set(linkedIds)
  const idSet = new Set<string>()
  const nameById = new Map<string, string>()
  const canonicalNameById = new Map<string, string>() // lowercased, trimmed

  for (const m of members) {
    if (!m?.id) continue
    idSet.add(m.id)
    nameById.set(m.id, m.name || '')
    canonicalNameById.set(m.id, (m.name || '').trim().toLowerCase())
  }
  const linkedNamesCanonical = linkedIds
    .map(id => canonicalNameById.get(id) || '')
    .filter(Boolean)

  return { linkedIdSet, linkedNamesCanonical }
}

/** True if the event includes ANY of the linked members (by id or canonical name), anywhere */
function eventMatchesLinked(evt: AnyRec, linkedIdSet: Set<string>, linkedNamesCanonical: string[]): boolean {
  let found = false

  const visit = (v: any) => {
    if (found || v == null) return
    const t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') {
      const s = String(v).trim()
      if (!s) return
      // ID match (exact)
      if (linkedIdSet.has(s)) { found = true; return }
      // Name match (case-insensitive, token-aware)
      const sc = s.toLowerCase()
      for (const name of linkedNamesCanonical) {
        if (!name) continue
        // require word boundary around the name to reduce false positives
        // e.g., "Rob" matches "Rob", "Rob Taylor", "Parent: Rob" but not "Robotics"
        const re = new RegExp(`(^|\\b|\\s)${escapeRegExp(name)}(\\b|\\s|$)`)
        if (re.test(sc)) { found = true; return }
      }
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) { visit(x); if (found) return }
      return
    }
    if (t === 'object') {
      for (const k in v) { visit(v[k]); if (found) return }
      return
    }
  }

  visit(evt)
  return found
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

  const lookups = buildMemberLookups(getMembers(), linked)

  const filtered = arr.filter(evt => eventMatchesLinked(evt, lookups.linkedIdSet, lookups.linkedNamesCanonical))
  try { return JSON.stringify(filtered) } catch { return origJSON }
}

// Install once & early
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
