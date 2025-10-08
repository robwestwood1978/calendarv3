// frontend/src/state/events-agenda.ts
//
// Fast, filtered agenda data:
// - Merges local events (base) with external feeds (integrations).
// - Applies per-occurrence "shadows" for edited external items.
// - Applies "My Agenda" and linked calendar filters by reading settings from localStorage.
// - Provides an in-memory cache keyed by (start,end,query,scopeKey), auto-invalidated on writes.
//
// Drop-in replacement.

import { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'
import * as base from './events'
import { externalExpanded, listCalendars } from './integrations'
import { isExternal, isShadow, toExtKey } from '../lib/external'

/* -------------------- storage keys (read-only) -------------------- */
const LS_SHADOWS   = 'fc_shadow_events_v1'
const LS_SETTINGS  = 'fc_settings_v3'     // we read settings to derive "My Agenda" & calendar filters

/* -------------------- small utils -------------------- */
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

/* -------------------- settings → scope filter -------------------- */

type Scope = {
  myAgendaEnabled: boolean
  includeMemberNames: Set<string>
  includeMemberIds: Set<string>
  includeEmails: Set<string>
  includeCalendarIds: Set<string>
}

function readScopeFromSettings(): Scope {
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
  return [
    sc.myAgendaEnabled ? '1' : '0',
    [...sc.includeMemberNames].sort().join(','),
    [...sc.includeMemberIds].sort().join(','),
    [...sc.includeEmails].sort().join(','),
    [...sc.includeCalendarIds].sort().join(','),
  ].join('|')
}

function eventMatchesScope(e: EventRecord, sc: Scope): boolean {
  // If no scope at all → allow everything.
  const hasAgendaFilter = sc.myAgendaEnabled && (sc.includeMemberNames.size || sc.includeMemberIds.size || sc.includeEmails.size)
  const hasCalendarFilter = sc.includeCalendarIds.size > 0

  if (!hasAgendaFilter && !hasCalendarFilter) return true

  // Calendar filter: external items often carry _calendarId; for locals this is absent → locals pass unless you later decide otherwise.
  if (hasCalendarFilter) {
    const calId = (e as any)._calendarId as string | undefined
    if (calId && !sc.includeCalendarIds.has(calId)) return false
  }

  if (hasAgendaFilter) {
    const atts = (e.attendees || []).map(String)
    // Names
    if (sc.includeMemberNames.size && atts.some(a => sc.includeMemberNames.has(a))) return true
    // Emails
    if (sc.includeEmails.size && atts.some(a => sc.includeEmails.has(a))) return true
    // Ids (some apps store attendees as ids in a parallel field)
    const attIds: string[] = ((e as any).attendeeIds || []) as string[]
    if (sc.includeMemberIds.size && attIds.some(id => sc.includeMemberIds.has(id))) return true
    // No match → exclude
    return false
  }

  return true
}

/* -------------------- fast cache for expansions -------------------- */

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

function clearCache() {
  memCache.clear()
}

// Invalidate cache on any data change (local/shadow) or cross-tab storage change
if (typeof window !== 'undefined') {
  window.addEventListener('fc:events-changed', clearCache)
  window.addEventListener('storage', clearCache)
}

/* -------------------- public reads -------------------- */

export function listExpanded(viewStart: DateTime, viewEnd: DateTime, query?: string): EventRecord[] {
  // Derive scope from settings every call; the object is small and memoized via the cache key
  const sc = readScopeFromSettings()
  const key = makeKey(viewStart, viewEnd, query || '', sc)

  const hit = memCache.get(key)
  if (hit) return hit.items

  // 1) local (base handles overrides & recurrence)
  const locals = base.listExpanded(viewStart, viewEnd, query)

  // 2) external
  const external = externalExpanded(viewStart, viewEnd, query) || []

  // 3) apply shadows to external occurrences
  const sMap = shadowMap()
  const mergedExternal = external.map((occ) => {
    const k = toExtKey(occ)
    if (k && sMap.has(k)) return { ...occ, ...sMap.get(k)!, source: 'shadow' } as EventRecord
    return occ
  })

  // 4) merge + scope filter
  const all = [...locals, ...mergedExternal]
  const filtered = all.filter(e => eventMatchesScope(e, sc))

  // 5) sort by start (then title)
  const sorted = filtered.sort((a, b) => a.start.localeCompare(b.start) || (a.title || '').localeCompare(b.title || ''))

  memCache.set(key, { key, items: sorted })
  return sorted
}

/* -------------------- writes (unchanged behavior from last good patch) -------------------- */

export function upsertEvent(evt: EventRecord): EventRecord {
  if (isExternal(evt) || isShadow(evt)) {
    const calId = (evt as any)._calendarId as string | undefined
    const cal = calId ? listCalendars().find(c => c.id === calId) : undefined
    if (!cal || !cal.allowEditLocal) { toast('This event is from an external calendar. Enable “Allow editing (local)” in Integrations to edit it.'); return evt }

    // Preserve original occurrence start across re-edits
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
    writeShadows(shadows)
    clearCache()
    return evt
  }

  // Local
  base.upsertEvent(evt, 'series')
  clearCache()
  return evt
}

export function deleteEvent(idOrEvt: string | EventRecord) {
  let evt: EventRecord | undefined
  if (typeof idOrEvt === 'string') {
    evt = readShadows().find(s => s.id === idOrEvt) as EventRecord | undefined
  } else {
    evt = idOrEvt
  }

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

/* -------------------- Home page range helper -------------------- */

/** Suggested Home window: today → +6 weeks (tweak as needed) */
export function suggestHomeRange(now: DateTime = DateTime.local()): { start: DateTime; end: DateTime } {
  const start = now.startOf('day')
  const end = start.plus({ weeks: 6 }).endOf('day')
  return { start, end }
}
