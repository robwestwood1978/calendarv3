// frontend/src/state/events-agenda.ts
//
// Fast agenda data with external shadows + in-memory cache.
// IMPORTANT: “My Agenda / linked calendars” filtering is DISABLED for now
// to avoid kiosk-mode confusion and any perf regressions.
//
// Also hard-clamps results to the requested [viewStart, viewEnd] window
// so an integration that over-returns can’t flood the UI.
//
// Drop-in replacement.

import { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'
import * as base from './events'
import { externalExpanded, listCalendars } from './integrations'
import { isExternal, isShadow, toExtKey } from '../lib/external'

/* -------------------- feature flags -------------------- */
const ENABLE_SCOPE_FILTER = false // keep OFF for kiosk; re-enable later if needed

/* -------------------- storage keys -------------------- */
const LS_SHADOWS  = 'fc_shadow_events_v1'
const LS_SETTINGS = 'fc_settings_v3' // read-only if you turn filters back on

/* -------------------- utils -------------------- */
function emitChanged() { try { window.dispatchEvent(new Event('fc:events-changed')) } catch {} }
function toast(msg: string) { try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {} }
function safeParse<T>(raw: string | null, fallback: T): T { if (!raw) return fallback; try { return JSON.parse(raw) as T } catch { return fallback } }

/* -------------------- shadows -------------------- */
type Shadow = EventRecord & {
  source: 'shadow'
  extKey: string
  shadowOf: string
  shadowAt: string
  _calendarId?: string
  _prevStart?: string
  _origOccStart?: string
}

function readShadows(): Shadow[] { return safeParse(localStorage.getItem(LS_SHADOWS), [] as Shadow[]) }
function writeShadows(arr: Shadow[]) { localStorage.setItem(LS_SHADOWS, JSON.stringify(arr)); emitChanged() }
function shadowMap(): Map<string, Shadow> { const m = new Map<string, Shadow>(); for (const s of readShadows()) m.set(s.extKey, s); return m }

/* -------------------- (optional) scope filtering shapes -------------------- */

type Scope = {
  myAgendaEnabled: boolean
  includeMemberNames: Set<string>
  includeMemberIds: Set<string>
  includeEmails: Set<string>
  includeCalendarIds: Set<string>
}

function readScopeFromSettings(): Scope {
  if (!ENABLE_SCOPE_FILTER) {
    return {
      myAgendaEnabled: false,
      includeMemberNames: new Set(),
      includeMemberIds: new Set(),
      includeEmails: new Set(),
      includeCalendarIds: new Set(),
    }
  }
  const s = safeParse<any>(localStorage.getItem(LS_SETTINGS), {})
  const myAg = s?.myAgenda || s?.agenda || {}
  const calFilter = s?.linkedCalendarIds || s?.calendarFilters?.includeIds || []

  const getSet = (arr: any) => new Set<string>((Array.isArray(arr) ? arr : []).filter(Boolean))

  return {
    myAgendaEnabled: !!(myAg?.enabled),
    includeMemberNames: getSet(myAg?.members || myAg?.memberNames),
    includeMemberIds:   getSet(myAg?.memberIds),
    includeEmails:      getSet(myAg?.emails),
    includeCalendarIds: getSet(calFilter),
  }
}

function scopeKey(sc: Scope): string {
  if (!ENABLE_SCOPE_FILTER) return 'OFF'
  return [
    sc.myAgendaEnabled ? '1' : '0',
    [...sc.includeMemberNames].sort().join(','),
    [...sc.includeMemberIds].sort().join(','),
    [...sc.includeEmails].sort().join(','),
    [...sc.includeCalendarIds].sort().join(','),
  ].join('|')
}

function eventMatchesScope(_e: EventRecord, sc: Scope): boolean {
  if (!ENABLE_SCOPE_FILTER) return true
  // If you re-enable later, re-use the logic we had previously.
  return true
}

/* -------------------- cache -------------------- */

type CacheKey = string
type CacheEntry = { key: CacheKey; items: EventRecord[] }

const memCache: Map<CacheKey, CacheEntry> = new Map()

function makeKey(start: DateTime, end: DateTime, query: string, sc: Scope): CacheKey {
  return [
    start.toISO(),
    end.toISO(),
    (query || '').trim().toLowerCase(),
    scopeKey(sc),
  ].join('::')
}

function clearCache() { memCache.clear() }

if (typeof window !== 'undefined') {
  window.addEventListener('fc:events-changed', clearCache)
  window.addEventListener('storage', clearCache)
}

/* -------------------- helpers -------------------- */

function overlapsWindow(e: EventRecord, a: DateTime, b: DateTime): boolean {
  // Show items that overlap the window at all:
  // (e.start <= b) && (e.end >= a)
  const s = DateTime.fromISO(e.start)
  const en = DateTime.fromISO(e.end)
  return s <= b && en >= a
}

/* -------------------- reads -------------------- */

export function listExpanded(viewStart: DateTime, viewEnd: DateTime, query?: string): EventRecord[] {
  const sc = readScopeFromSettings()
  const key = makeKey(viewStart, viewEnd, query || '', sc)
  const hit = memCache.get(key)
  if (hit) return hit.items

  // 1) local (base handles recurrence/overrides)
  const locals = base.listExpanded(viewStart, viewEnd, query)

  // 2) external (ensure integrations obey the range; we’ll clamp anyway)
  const external = externalExpanded(viewStart, viewEnd, query) || []

  // 3) apply shadows to external occurrences
  const sMap = shadowMap()
  const mergedExternal = external.map((occ) => {
    const k = toExtKey(occ)
    if (k && sMap.has(k)) return { ...occ, ...sMap.get(k)!, source: 'shadow' } as EventRecord
    return occ
  })

  // 4) merge + optional scope filter (currently off)
  const merged = [...locals, ...mergedExternal].filter(e => eventMatchesScope(e, sc))

  // 5) HARD CLAMP to the requested window so nothing outside leaks in
  const clamped = merged.filter(e => overlapsWindow(e, viewStart, viewEnd))

  // 6) sort
  const sorted = clamped.sort((a, b) => a.start.localeCompare(b.start) || (a.title || '').localeCompare(b.title || ''))
  memCache.set(key, { key, items: sorted })
  return sorted
}

/* -------------------- writes -------------------- */

export function upsertEvent(evt: EventRecord): EventRecord {
  if (isExternal(evt) || isShadow(evt)) {
    const calId = (evt as any)._calendarId as string | undefined
    const cal = calId ? listCalendars().find(c => c.id === calId) : undefined
    if (!cal || !cal.allowEditLocal) { toast('This event is from an external calendar. Enable “Allow editing (local)” in Integrations to edit it.'); return evt }

    const origOccStart = (evt as any)._origOccStart || (evt as any)._prevStart || evt.start
    const candidate = { ...(evt as any), start: origOccStart }
    const key = toExtKey(candidate) || (evt as any).extKey || null
    if (!key) { toast('Unable to key this external occurrence for editing.'); return evt }

    const shadows = readShadows()
    const idx = shadows.findIndex(s => s.extKey === key)
    const shadow: Shadow = {
      ...(evt as any),
      source: 'shadow',
      extKey: key,
      shadowOf: String((evt as any).id ?? (evt as any).uid ?? 'ext'),
      shadowAt: new Date().toISOString(),
      _calendarId: calId,
      _prevStart: (evt as any)._prevStart,
      _origOccStart: origOccStart,
    }
    if (idx >= 0) shadows[idx] = shadow; else shadows.push(shadow)
    writeShadows(shadows); clearCache()
    return evt
  }

  base.upsertEvent(evt, 'series')
  clearCache()
  return evt
}

export function deleteEvent(idOrEvt: string | EventRecord) {
  let evt: EventRecord | undefined
  if (typeof idOrEvt === 'string') evt = readShadows().find(s => s.id === idOrEvt) as EventRecord | undefined
  else evt = idOrEvt

  if (evt && (isExternal(evt) || isShadow(evt))) {
    const origOccStart = (evt as any)._origOccStart || (evt as any)._prevStart || evt.start
    const candidate = { ...(evt as any), start: origOccStart }
    const key = toExtKey(candidate) || (evt as any).extKey || null
    if (key) {
      writeShadows(readShadows().filter(s => s.extKey !== key))
      clearCache()
      return
    }
  }

  if (evt) { base.deleteEvent(evt, 'series'); clearCache() }
}

/* -------------------- Home range helper -------------------- */
export function suggestHomeRange(now: DateTime = DateTime.local()): { start: DateTime; end: DateTime } {
  // Start "now" (to exclude already-ended items), end at +8 weeks
  const start = now.startOf('minute')
  const end = start.plus({ weeks: 8 }).endOf('day')
  return { start, end }
}
