// frontend/src/lib/migrateSliceC.ts
// Idempotent, storage-only preflight for Slice C.
// Ensures settings & events have safe shapes for additive features.
// Runs on import (see main.tsx). No hooks; no UI.

const LS_SETTINGS = 'fc_settings_v3'
const LS_EVENTS = 'fc_events_v1'

type AnyRec = Record<string, any>

// Safe JSON read
function readJSON<T = any>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch { return null }
}

// Safe JSON write
function writeJSON(key: string, value: any) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// 1) Harden settings shape: ensure object, ensure members array, ensure myAgendaOnly boolean
(function migrateSettings() {
  const s0 = readJSON<AnyRec>(LS_SETTINGS) || {}
  const out: AnyRec = { ...s0 }

  if (!Array.isArray(out.members)) out.members = []

  // Additive field for Slice C (harmless for A/B)
  if (typeof out.myAgendaOnly !== 'boolean') out.myAgendaOnly = false

  // Keep existing keys intact; write back only if changed
  const changed = JSON.stringify(s0) !== JSON.stringify(out)
  if (changed) writeJSON(LS_SETTINGS, out)
})()

// 2) Harden events list shape (array). Do NOT modify event content.
(function migrateEvents() {
  const e0 = readJSON<any[]>(LS_EVENTS)
  if (!Array.isArray(e0)) {
    if (e0 == null) writeJSON(LS_EVENTS, [])
    else writeJSON(LS_EVENTS, Array.isArray(e0) ? e0 : [])
  }
})()

// Emit a single, quiet signal for any listeners (optional)
try { window.dispatchEvent(new CustomEvent('fc:preflight:done')) } catch {}

export {} // keep as a module
