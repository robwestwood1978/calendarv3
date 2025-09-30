// frontend/src/lib/migrateSliceC.ts
// Idempotent, storage-only preflight for Slice C.
// Safe for minifiers: no chained IIFEs; explicit function calls with semicolons.

const LS_SETTINGS = 'fc_settings_v3'
const LS_EVENTS = 'fc_events_v1'

type AnyRec = Record<string, any>

function readJSON<T = any>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function migrateSettings(): void {
  const prev = readJSON<AnyRec>(LS_SETTINGS) || {}
  const next: AnyRec = { ...prev }

  if (!Array.isArray(next.members)) next.members = []
  if (typeof next.myAgendaOnly !== 'boolean') next.myAgendaOnly = false

  if (JSON.stringify(prev) !== JSON.stringify(next)) {
    writeJSON(LS_SETTINGS, next)
  }
}

function migrateEvents(): void {
  const prev = readJSON<any[]>(LS_EVENTS)
  if (!Array.isArray(prev)) {
    writeJSON(LS_EVENTS, prev == null ? [] : (Array.isArray(prev) ? prev : []))
  }
}

export function runMigrateSliceC(): void {
  try {
    migrateSettings()
    migrateEvents()
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('fc:preflight:done'))
  } catch {}
}

// Execute on import (side effect)
runMigrateSliceC()
