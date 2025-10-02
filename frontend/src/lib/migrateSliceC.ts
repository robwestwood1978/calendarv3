// frontend/src/lib/migrateSliceC.ts
// SAFE, idempotent Slice C migration.
// IMPORTANT: Do NOT create a new fc_settings_v3 from scratch.
// If settings are missing, leave them missing so SettingsProvider can bootstrap defaults.

type AnyRec = Record<string, any>

const LS_SETTINGS = 'fc_settings_v3'
const LS_EVENTS   = 'fc_events_v1'

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}
function writeLS(key: string, val: any) { localStorage.setItem(key, JSON.stringify(val)) }

// Only harden an **existing** settings object.
// If nothing exists (null) or it's an empty object lacking core fields, DO NOTHING.
function ensureSettings() {
  const raw = localStorage.getItem(LS_SETTINGS)
  const s = safeParse<any>(raw)

  // Nothing stored yet → let SettingsProvider bootstrap; do not write.
  if (s == null) return

  // Heuristic: only patch if this looks like a real settings payload (has known fields).
  const looksReal =
    typeof s === 'object' &&
    (
      Array.isArray(s.members) ||
      typeof s.defaults === 'object' ||
      typeof s.weekStartMonday === 'boolean' ||
      typeof s.timeFormat24h === 'boolean'
    )

  if (!looksReal) return // don't touch odd/partial objects

  let changed = false

  // Only add myAgendaOnly if not present
  if (typeof s.myAgendaOnly !== 'boolean') {
    s.myAgendaOnly = false
    changed = true
  }

  if (changed) writeLS(LS_SETTINGS, s)
}

function ensureEvents() {
  const arr = safeParse<any[]>(localStorage.getItem(LS_EVENTS))
  if (!Array.isArray(arr)) return

  let changed = false
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue
    if (!e.id) { e.id = `e_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`; changed = true }
    // Non-breaking sync stubs (don’t change behaviour)
    if (e.createdByUserId === undefined) e.createdByUserId = undefined
    if (e.ownerMemberId === undefined) e.ownerMemberId = undefined
  }
  if (changed) writeLS(LS_EVENTS, arr)
}

export function migrateSliceC(): void {
  try {
    ensureSettings()
    ensureEvents()
  } catch {
    // never throw during app boot
  }
}
