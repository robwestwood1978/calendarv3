// frontend/src/sync/journalizer.ts
// Watches the local event store and records mutations to the journal.
// - Defensive against missing/invalid storage
// - No 'for..of' over undefined
// - Stable hashing so harmless field order changes don’t spam updates

import { recordMutation } from './journal'

// ---- Storage keys (match your app) ----
const LS_EVENTS = 'fc_events_v1'
const LS_SHADOW = 'fc_journal_shadow_v1'

// ---- Types (loose to tolerate your current shapes) ----
type AnyEvent = {
  id: string
  title?: string
  start: string
  end: string
  allDay?: boolean
  location?: string
  notes?: string
  attendees?: string[]
  tags?: string[]
  colour?: string
  // optional bindings used by push
  _remote?: Array<{
    provider: string
    calendarId?: string
    externalId?: string
    etag?: string
  }>
  [k: string]: any
}

type Shadow = {
  // keep the full event for “before” snapshots, plus a hash for quick comparison
  map: Record<string, { hash: string; ev: AnyEvent }>
  // version for future migrations
  v: 1
}

// ---- Utilities ----
function safeParse<T>(val: string | null): T | null {
  if (!val) return null
  try { return JSON.parse(val) as T } catch { return null }
}

/** Load current events from your local store (defensive for several shapes). */
function loadCurrent(): AnyEvent[] {
  const raw = safeParse<any>(localStorage.getItem(LS_EVENTS))
  if (!raw) return []

  // common shapes:
  // 1) direct array
  if (Array.isArray(raw)) {
    return raw.filter(isEventLike)
  }

  // 2) { events: [...] }
  if (Array.isArray(raw.events)) {
    return raw.events.filter(isEventLike)
  }

  // 3) { byId: { id: ev } }
  if (raw.byId && typeof raw.byId === 'object') {
    return Object.values(raw.byId).filter(isEventLike)
  }

  // Unknown shape → no-op
  return []
}

function isISO(x: any): boolean {
  if (typeof x !== 'string') return false
  const d = new Date(x)
  return !isNaN(+d)
}

function isEventLike(x: any): x is AnyEvent {
  return x && typeof x === 'object' && typeof x.id === 'string' && isISO(x.start) && isISO(x.end)
}

function readShadow(): Shadow {
  const s = safeParse<Shadow>(localStorage.getItem(LS_SHADOW))
  if (s && s.v === 1 && s.map && typeof s.map === 'object') return s
  return { v: 1, map: {} }
}

function writeShadow(sh: Shadow) {
  localStorage.setItem(LS_SHADOW, JSON.stringify(sh))
}

/** Minimal, stable hash of fields we want to sync on. */
function hashEvent(ev: AnyEvent): string {
  // normalise some fields
  const attendees = Array.isArray(ev.attendees) ? [...ev.attendees].sort() : []
  const tags = Array.isArray(ev.tags) ? [...ev.tags].sort() : []

  // important: use stable key order
  const obj = {
    title: ev.title || '',
    start: new Date(ev.start).toISOString(),
    end: new Date(ev.end).toISOString(),
    allDay: !!ev.allDay,
    location: ev.location || '',
    notes: ev.notes || '',
    attendees,
    tags,
    colour: ev.colour || '',
  }
  return JSON.stringify(obj)
}

function toBeforeMinimal(ev: AnyEvent) {
  return {
    id: ev.id,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    location: ev.location,
    notes: ev.notes,
    attendees: ev.attendees,
    tags: ev.tags,
    colour: ev.colour,
    _remote: ev._remote,
  }
}

// ---- Diff + journal ----
function diffAndJournal(prev: Shadow, curr: AnyEvent[]) {
  try {
    const nextShadow: Shadow = { v: 1, map: {} }

    // Build current map & detect creates / updates
    for (let i = 0; i < curr.length; i++) {
      const ev = curr[i]
      if (!isEventLike(ev)) continue
      const h = hashEvent(ev)
      nextShadow.map[ev.id] = { hash: h, ev: toBeforeMinimal(ev) }

      const prevRec = prev.map[ev.id]
      if (!prevRec) {
        // CREATE
        recordMutation('create', undefined, toBeforeMinimal(ev), ev.id)
        continue
      }
      if (prevRec.hash !== h) {
        // UPDATE
        recordMutation('update', prevRec.ev, toBeforeMinimal(ev), ev.id)
      }
    }

    // Detect deletes
    const currIds = new Set(Object.keys(nextShadow.map))
    for (const id of Object.keys(prev.map)) {
      if (!currIds.has(id)) {
        const before = prev.map[id]?.ev
        recordMutation('delete', before, undefined, id)
      }
    }

    writeShadow(nextShadow)
    console.log('[journalizer] shadow updated. events:', Object.keys(nextShadow.map).length)
  } catch (err) {
    console.warn('[journalizer] error', err)
  }
}

// ---- Runner ----
let rafId = 0
function scheduleRun() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    const prev = readShadow()
    const curr = loadCurrent()
    diffAndJournal(prev, curr)
  })
}

export function startJournalizer() {
  // initial
  scheduleRun()
  // react to app-level event and cross-tab changes
  window.addEventListener('fc:events-changed', scheduleRun)
  window.addEventListener('storage', (e) => {
    if (e.key === LS_EVENTS) scheduleRun()
  })

  // small debug helpers
  ;(window as any).fcDebugJournalDump = () => {
    console.log('shadow:', readShadow())
    console.log('events:', loadCurrent())
  }
  console.log('[journalizer] ready')
}

// Auto-start if module loaded before main bootstrap wires it
try { startJournalizer() } catch {}
