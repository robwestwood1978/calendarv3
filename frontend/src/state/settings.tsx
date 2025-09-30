// src/state/settings.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'

export type MemberRole = 'parent' | 'adult' | 'child'
export interface Member {
  id: string
  name: string
  role: MemberRole
  colour?: string
  email?: string
}

export type RuleType = 'member' | 'tag' | 'role'
export interface ColourRule {
  id: string
  type: RuleType
  value: string
  colour: string
}

export interface SettingsState {
  theme: 'light' | 'dark'
  denseHours: boolean
  fontScale: number
  timezone: string
  tags: string[]
  bringPresets: string[]
  members: Member[]
  colourRules: ColourRule[]
  memberLookup: Record<string, Member>
  defaults: {
    durationMin: number
    colour: string
    remindersMin: number[]
  }
}

const LS_KEY = 'fc_settings_v3'

function hydrate(s: SettingsState): SettingsState {
  const memberLookup: Record<string, Member> = {}
  for (const m of s.members || []) memberLookup[m.name] = m
  return { ...s, memberLookup }
}

export const defaultState: SettingsState = hydrate({
  theme: 'light',
  denseHours: false,
  fontScale: 1,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
  tags: ['School', 'Sports', 'Clubs', 'Medical'],
  bringPresets: ['Water Bottle', 'Boots', 'Shin Pads', 'PE Kit', 'Homework', 'Reading Book', 'Snacks'],
  members: [
    { id: 'm1', name: 'Parent 1', role: 'parent', colour: '#8b5cf6' },
    { id: 'm2', name: 'Parent 2', role: 'parent', colour: '#06b6d4' },
    { id: 'c1', name: 'Child', role: 'child', colour: '#10b981' },
  ],
  colourRules: [],
  defaults: { durationMin: 60, colour: '#1e88e5', remindersMin: [30] },
} as SettingsState)

function load(): SettingsState {
  if (typeof window === 'undefined') return defaultState
  try {
    const raw = localStorage.getItem(LS_KEY)
    const parsed = raw ? (JSON.parse(raw) as SettingsState) : defaultState
    return hydrate(parsed)
  } catch {
    return defaultState
  }
}
function save(state: SettingsState) {
  localStorage.setItem(LS_KEY, JSON.stringify(state))
  try { window.dispatchEvent(new Event('fc:settings-changed')) } catch {}
}

/** Colour precedence: Member → Tag → Role → Event colour. */
export function pickEventColour(args: {
  baseColour?: string
  memberNames?: string[]
  tags?: string[]
  rules: ColourRule[]
  memberLookup: Record<string, Member>
}): string | undefined {
  const { baseColour, memberNames = [], tags = [], rules, memberLookup } = args
  for (const n of memberNames) {
    const hit = rules.find(r => r.type === 'member' && r.value === n)
    if (hit) return hit.colour
    const m = memberLookup[n]; if (m?.colour) return m.colour
  }
  for (const t of tags) {
    const hit = rules.find(r => r.type === 'tag' && r.value === t)
    if (hit) return hit.colour
  }
  const roles = memberNames.map(n => memberLookup[n]?.role).filter(Boolean) as MemberRole[]
  for (const r of roles) {
    const hit = rules.find(rr => rr.type === 'role' && rr.value === r)
    if (hit) return hit.colour
  }
  return baseColour
}

/* -------------------- Context + Safe Hook -------------------- */

type SettingsCtxType = SettingsState & {
  setTheme: (t: 'light' | 'dark') => void
  setDense: (on: boolean) => void
  setFontScale: (f: number) => void
  setTimezone: (tz: string) => void
  addTag: (t: string) => void
  removeTag: (t: string) => void
  addBring: (t: string) => void
  removeBring: (t: string) => void
  addMember: (m: Omit<Member, 'id'>) => void
  updateMember: (id: string, patch: Partial<Member>) => void
  removeMember: (id: string) => void
  addRule: (r: Omit<ColourRule, 'id'>) => void
  updateRule: (id: string, patch: Partial<ColourRule>) => void
  removeRule: (id: string) => void
  setDefaults: (d: Partial<SettingsState['defaults']>) => void
}

const SettingsCtx = createContext<SettingsCtxType | null>(null)

// no-op mutators for fallback
const noop = () => {}
const fallbackCtx: SettingsCtxType = {
  ...defaultState,
  setTheme: noop, setDense: noop, setFontScale: noop, setTimezone: noop,
  addTag: noop, removeTag: noop, addBring: noop, removeBring: noop,
  addMember: noop, updateMember: noop, removeMember: noop,
  addRule: noop, updateRule: noop, removeRule: noop,
  setDefaults: noop,
}

/** Safe hook: never crashes if Provider is missing. */
export function useSettings(): SettingsCtxType {
  return useContext(SettingsCtx) || fallbackCtx
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<SettingsState>(() => load())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const h = () => setTick(x => x + 1)
    window.addEventListener('storage', h)
    window.addEventListener('fc:settings-changed', h)
    return () => { window.removeEventListener('storage', h); window.removeEventListener('fc:settings-changed', h) }
  }, [])

  const state = useMemo(() => hydrate(s), [s, tick])

  useEffect(() => {
    const el = document.documentElement
    el.classList.toggle('theme-dark', state.theme === 'dark')
    el.style.setProperty('--font-scale', String(state.fontScale))
  }, [state.theme, state.fontScale])

  const update = (mut: (prev: SettingsState) => SettingsState) => {
    setS(prev => { const next = mut(prev); save(next); return next })
  }

  const api: SettingsCtxType = {
    ...state,
    setTheme: (t) => update(p => ({ ...p, theme: t })),
    setDense: (on) => update(p => ({ ...p, denseHours: on })),
    setFontScale: (f) => update(p => ({ ...p, fontScale: Math.max(0.9, Math.min(1.2, f)) })),
    setTimezone: (tz) => update(p => ({ ...p, timezone: tz })),
    addTag: (t) => update(p => ({ ...p, tags: addUniq(p.tags, t) })),
    removeTag: (t) => update(p => ({ ...p, tags: p.tags.filter(x => x !== t) })),
    addBring: (t) => update(p => ({ ...p, bringPresets: addUniq(p.bringPresets, t) })),
    removeBring: (t) => update(p => ({ ...p, bringPresets: p.bringPresets.filter(x => x !== t) })),
    addMember: (m) => update(p => ({ ...p, members: [...p.members, { id: newId('m'), ...m }] })),
    updateMember: (id, patch) => update(p => ({ ...p, members: p.members.map(m => m.id === id ? { ...m, ...patch } : m) })),
    removeMember: (id) => update(p => ({ ...p, members: p.members.filter(m => m.id !== id) })),
    addRule: (r) => update(p => ({ ...p, colourRules: [...p.colourRules, { id: newId('r'), ...r }] })),
    updateRule: (id, patch) => update(p => ({ ...p, colourRules: p.colourRules.map(r => r.id === id ? { ...r, ...patch } : r) })),
    removeRule: (id) => update(p => ({ ...p, colourRules: p.colourRules.filter(r => r.id !== id) })),
    setDefaults: (d) => update(p => ({ ...p, defaults: { ...p.defaults, ...d } })),
  }

  return <SettingsCtx.Provider value={api}>{children}</SettingsCtx.Provider>
}

function addUniq(arr: string[], v: string) {
  const t = v.trim(); if (!t) return arr; if (arr.includes(t)) return arr; return [...arr, t]
}
function newId(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}` }

/** Small date-time formatter used across the app. */
export function fmt(dt: DateTime | string, tz?: string, pattern = 'ccc d LLL, HH:mm'): string {
  const d = typeof dt === 'string' ? DateTime.fromISO(dt) : dt
  const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone
  return d.setZone(zone).toFormat(pattern)
}
