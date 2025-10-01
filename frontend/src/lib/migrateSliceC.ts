// frontend/src/lib/migrateSliceC.ts
// Slice C preflight: DO NOT TOUCH fc_settings_v3.
// Only ensure fc_events_v1 is an array so A/B code stays safe.

const LS_EVENTS = 'fc_events_v1'

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function ensureEventsArray() {
  try {
    const prev = safeParse<any[]>(localStorage.getItem(LS_EVENTS))
    if (Array.isArray(prev)) return
    // If missing or malformed, set to empty array (A/B-safe)
    localStorage.setItem(LS_EVENTS, '[]')
  } catch {
    // fail silent
  }
}

export function runMigrateSliceC(): void {
  ensureEventsArray()
  try { window.dispatchEvent(new CustomEvent('fc:preflight:done')) } catch {}
}

// Execute on import (side effect)
runMigrateSliceC()
