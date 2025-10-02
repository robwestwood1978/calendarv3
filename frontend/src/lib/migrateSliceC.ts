// frontend/src/lib/migrateSliceC.ts
// Idempotent hardening for Slice C (safe to run every load).
// - Ensure fc_settings_v3 has myAgendaOnly?: boolean (default false).
// - Ensure events have a stable id (prefix 'e_' + timestamp + rand) if missing.
// - Prepare optional ownership fields (createdByUserId?, ownerMemberId?) without changing behaviour.

type AnyRec = Record<string, any>

const LS_SETTINGS = 'fc_settings_v3'
const LS_EVENTS   = 'fc_events_v1'

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}
function writeLS(key: string, val: any) { localStorage.setItem(key, JSON.stringify(val)) }

function ensureSettings() {
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS)) || {}
  let changed = false

  if (typeof s.myAgendaOnly !== 'boolean') { s.myAgendaOnly = false; changed = true }

  // Keep existing members, colour rules, etc. intact. Do not mutate shape otherwise.
  if (changed) writeLS(LS_SETTINGS, s)
}

function ensureEvents() {
  const arr = safeParse<any[]>(localStorage.getItem(LS_EVENTS))
  if (!Array.isArray(arr)) return

  let changed = false
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue
    if (!e.id) { e.id = `e_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`; changed = true }
    // Non-breaking stubs for Slice D sync:
    if (e.createdByUserId === undefined) e.createdByUserId = undefined
    if (e.ownerMemberId === undefined) e.ownerMemberId = undefined
  }
  if (changed) writeLS(LS_EVENTS, arr)
}

export function migrateSliceC(): void {
  try {
    ensureSettings()
    ensureEvents()
  } catch { /* no-op; never throw during boot */ }
}
