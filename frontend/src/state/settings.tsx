// frontend/src/state/settings.tsx
// Stable, A/B-compatible settings API.
// - `useSettings()` returns PLAIN DATA (no wrappers), with `members` ALWAYS an array.
// - No reliance on React Context (avoids "must be used within provider" & duplicate module issues).
// - Global singleton store via window to prevent multiple bundle copies fighting.
// - Exposes mutation helpers via `useSettingsActions()`; NOT needed by read-only callers.
// - Keeps A/B helpers: fmt, pickEventColour, listMembers, readEventsRaw.
// - Exports SettingsProvider as a no-op to satisfy existing JSX trees.

import React, { useMemo, useSyncExternalStore } from 'react'
import { DateTime } from 'luxon'

/* -------------------------- Keys & types -------------------------- */

const LS_SETTINGS = 'fc_settings_v3'
const LS_EVENTS = 'fc_events_v1'
const GLOBAL_KEY = '__fcSettingsStore_v1' // global singleton key

export type MemberRole = 'parent' | 'adult' | 'child'
export type Member = { id: string; name: string; role?: MemberRole; colour?: string }
export type Settings = {
  weekStartMonday?: boolean
  timeFormat24h?: boolean
  defaultDurationMins?: number
  members: Member[]            // ALWAYS an array
  myAgendaOnly?: boolean       // harmless if unused
}

/* -------------------------- Formatting helpers -------------------------- */

export const fmt = {
  day(dt: DateTime) { return dt.toFormat('ccc d LLL') },
  time(dt: DateTime) { return dt.toFormat('HH:mm') },
}

/* -------------------------- Normalisation & IO -------------------------- */

function normalizeSettings(input: any): Settings {
  const s = (input && typeof input === 'object') ? input : {}
  return {
    weekStartMonday: typeof s.weekStartMonday === 'boolean' ? s.weekStartMonday : false,
    timeFormat24h: typeof s.timeFormat24h === 'boolean' ? s.timeFormat24h : true,
    defaultDurationMins: typeof s.defaultDurationMins === 'number' ? s.defaultDurationMins : 60,
    members: Array.isArray(s.members) ? s.members : [],
    myAgendaOnly: typeof s.myAgendaOnly === 'boolean' ? s.myAgendaOnly : false,
  }
}

function readSettingsRaw(): any {
  try {
    const raw = localStorage.getItem(LS_SETTINGS)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function readSettings(): Settings {
  return normalizeSettings(readSettingsRaw())
}

function writeSettings(next: any) {
  const merged = { ...readSettingsRaw(), ...next }
  const normalized = normalizeSettings(merged)
  const out = { ...merged, ...normalized, members: normalized.members, myAgendaOnly: normalized.myAgendaOnly }
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(out)) } catch {}
  // notify all listeners (across all copies)
  try { window.dispatchEvent(new CustomEvent('fc:settings:changed')) } catch {}
}

/* -------------------------- Global singleton store -------------------------- */

type Store = {
  get: () => Settings
  set: (update: Partial<Settings> | ((s: Settings) => Settings)) => void
  setMyAgendaOnly: (on: boolean) => void
  subscribe: (fn: () => void) => () => void
}

function createStore(): Store {
  const get = () => readSettings()
  const set: Store['set'] = (update) => {
    const current = readSettings()
    const next = typeof update === 'function'
      ? (update as (s: Settings) => Settings)(current)
      : { ...current, ...update }
    if (!Array.isArray(next.members)) next.members = []
    writeSettings(next as any)
  }
  const setMyAgendaOnly = (on: boolean) => set({ myAgendaOnly: !!on })
  const subscribe = (fn: () => void) => {
    const onCustom = () => fn()
    const onStorage = (e: StorageEvent) => { if (e.key === LS_SETTINGS) fn() }
    window.addEventListener('fc:settings:changed', onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('fc:settings:changed', onCustom)
      window.removeEventListener('storage', onStorage)
    }
  }
  return { get, set, setMyAgendaOnly, subscribe }
}

// Ensure a single store is shared even if bundler duplicates this module
const store: Store = (() => {
  const w = window as any
  if (w[GLOBAL_KEY] && typeof w[GLOBAL_KEY] === 'object') return w[GLOBAL_KEY] as Store
  const s = createStore()
  try { w[GLOBAL_KEY] = s } catch {}
  return s
})()

/* -------------------------- Public hooks -------------------------- */

// READ: plain data; safe for every A/B call site (`const s = useSettings(); s.members.map(...)`)
export function useSettings(): Settings {
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get)
  // guarantee `members` is an array even if storage is empty/corrupt
  return useMemo(
    () => ({ ...snapshot, members: Array.isArray(snapshot.members) ? snapshot.members : [] }),
    [snapshot]
  )
}

// WRITE: explicit actions (only components that mutate need this)
export function useSettingsActions(): Pick<Store, 'set' | 'setMyAgendaOnly'> {
  return { set: store.set, setMyAgendaOnly: store.setMyAgendaOnly }
}

/* -------------------------- Convenience readers -------------------------- */

export function listMembers(): Member[] {
  return readSettings().members // ALWAYS array
}

export function readEventsRaw(): any[] {
  try {
    const raw = localStorage.getItem(LS_EVENTS)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

/* -------------------------- Colour helper -------------------------- */

export function pickEventColour(evt: any, settings: Settings): string | undefined {
  const map = new Map<string, string>()
  ;(settings.members || []).forEach((m) => { if (m.id && m.colour) map.set(m.id, m.colour) })

  const attendees: string[] = evt?.attendeeIds || evt?.attendees || evt?.members || []
  for (const mId of Array.isArray(attendees) ? attendees : []) {
    const c = map.get(mId); if (c) return c
  }
  const responsible: string | undefined = evt?.responsibleId || evt?.responsibleMemberId
  if (responsible && map.has(responsible)) return map.get(responsible)
  const owner: string | undefined = evt?.ownerMemberId
  if (owner && map.has(owner)) return map.get(owner)
  return evt?.colour || evt?.color
}

/* -------------------------- No-op provider (compat with JSX trees) -------------------------- */
// Your main.tsx wraps with <SettingsProvider>. Keep it; this provider intentionally does nothing.
// `useSettings()` does not depend on it, so duplicate contexts cannot break anything.
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// Default export for legacy default imports
export default useSettings
