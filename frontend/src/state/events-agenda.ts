// frontend/src/state/events-agenda.ts
//
// Combines local events (state/events.ts) with integrated external feeds,
// and manages "shadow" events for local edits of external (Apple/Google/ICS) items.
//
// Key points:
// - listExpanded(start, end, query): merge local + external, apply shadows that replace the
//   original external occurrence (computed by extKey).
// - upsertEvent(evt): for external items, create/update a shadow keyed by the *original*
//   occurrence start (evt._prevStart when present). For locals, delegate to base upsert.
// - deleteEvent(evt): remove a shadow for external; delegate to base for locals.
// - Emits 'fc:events-changed' whenever data persists so UI refreshes.
//

import { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'

import * as base from './events' // local calendar source of truth (CRUD for local events)
import { externalExpanded, listCalendars } from './integrations' // your integrations layer
import { isExternal, isShadow, toExtKey } from '../lib/external'  // helpers for external keys/meta

/* ---------------------------- constants / storage ---------------------------- */

const LS_SHADOWS = 'fc_shadow_events_v1'

/* ---------------------------- small utilities ---------------------------- */

function emitChanged() {
  try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
}

function toast(msg: string) {
  try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

/* ---------------------------- shadow events ---------------------------- */

/**
 * A Shadow is a local edit that replaces a single *occurrence* of an external event.
 * It is keyed by 'extKey' which encodes: calendarId :: external UID :: occurrence start.
 * We always compute the extKey using the occurrence's *original start time* (evt._prevStart if present).
 */
type Shadow = EventRecord & {
  source: 'shadow'
  extKey: string
  shadowOf: string         // original external event id/uid (stringified)
  shadowAt: string         // ISO timestamp of when the shadow was created/updated
  _calendarId?: string     // keep calendar id for convenience
  _prevStart?: string      // stored for re-edits; still compute extKey from original occurrence
}

function readShadows(): Shadow[] {
  return safeParse<Shadow[]>(localStorage.getItem(LS_SHADOWS), [])
}

function writeShadows(arr: Shadow[]) {
  localStorage.setItem(LS_SHADOWS, JSON.stringify(arr))
  emitChanged()
}

function shadowMap(): Map<string, Shadow> {
  const map = new Map<string, Shadow>()
  for (const s of readShadows()) map.set(s.extKey, s)
  return map
}

/* ---------------------------- public reads ---------------------------- */

/**
 * Expand and merge sources:
 *  - Local expanded events from base.listExpanded
 *  - External expanded events from integrations.externalExpanded
 *  - Apply shadows: if a shadow with a matching extKey exists for an external occurrence,
 *    replace that occurrence with the shadow.
 *  - Optional query filter is already respected by the two sources; we still guard once more.
 */
export function listExpanded(viewStart: DateTime, viewEnd: DateTime, query?: string): EventRecord[] {
  // Local events go through existing series/override logic in base layer:
  const locals = base.listExpanded(viewStart, viewEnd, query)

  // External (Apple/Google/ICS) expansion comes from the integrations layer:
  const external = externalExpanded(viewStart, viewEnd, query) || []

  // Apply shadows to external occurrences
  const sMap = shadowMap()
  const mergedExternal = external.map((occ) => {
    // We generate an extKey for THIS occurrence as provided by integrations:
    const key = toExtKey(occ)
    if (key && sMap.has(key)) {
      const sh = sMap.get(key)!
      // Take the shadow's fields but keep any minimal metadata you rely on.
      // Shadow becomes the thing we render for this occurrence.
      return {
        ...occ,
        ...sh,
        source: 'shadow',
      } as EventRecord
    }
    return occ
  })

  // Merge and sort
  const all = [...locals, ...mergedExternal]
  const q = (query || '').trim().toLowerCase()
  const filtered = q
    ? all.filter(e => matchQuery(e, q))
    : all

  return filtered.sort((a, b) => a.start.localeCompare(b.start) || (a.title || '').localeCompare(b.title || ''))
}

/** Query against title/location/notes/tags/attendees/checklist */
function matchQuery(e: EventRecord, q: string): boolean {
  const hay = [
    e.title, e.location, e.notes,
    ...(e.tags || []),
    ...(e.attendees || []),
    ...(e.checklist || []),
  ].join(' ').toLowerCase()
  return hay.includes(q)
}

/* ---------------------------- guarded writes ---------------------------- */

/**
 * Upsert for agenda:
 * - If the event is external (or a shadow of one), write/update a SHADOW keyed to the original occurrence.
 * - If it is local, delegate to base.upsertEvent (the caller chooses edit scope there).
 *
 * Notes:
 * - We require the calendar to allow local edits (`allowEditLocal`) before we store a shadow.
 * - The shadow extKey must be computed from the ORIGINAL occurrence's start:
 *     extKey = toExtKey({ ...evt, start: _prevStart || evt.start })
 */
export function upsertEvent(evt: EventRecord): EventRecord {
  // External → shadow path
  if (isExternal(evt) || isShadow(evt)) {
    // Can this calendar be edited locally?
    const calId = (evt as any)._calendarId as string | undefined
    const cal = calId ? listCalendars().find(c => c.id === calId) : undefined
    if (!cal || !cal.allowEditLocal) {
      toast('This event is from an external calendar. Enable “Allow editing (local)” in Integrations to edit it.')
      return evt
    }

    // Compute extKey from ORIGINAL occurrence start (evt._prevStart if present)
    const origStart = (evt as any)._prevStart || evt.start
    const candidate = { ...(evt as any), start: origStart }
    const key = toExtKey(candidate) || (evt as any).extKey || null

    if (!key) {
      // If integrations didn’t give us sufficient metadata to form a key, we can’t persist a shadow that maps back.
      toast('Unable to key this external occurrence for editing.')
      return evt
    }

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
    }

    if (idx >= 0) shadows[idx] = shadow
    else shadows.push(shadow)

    writeShadows(shadows)
    return evt
  }

  // Local → delegate to base (the caller provides scope if needed elsewhere)
  base.upsertEvent(evt, 'series')
  return evt
}

/**
 * Delete for agenda:
 * - For external/shadow: remove the shadow that corresponds to this occurrence.
 *   The key again must be derived from the ORIGINAL occurrence time (evt._prevStart if present),
 *   or from evt.extKey if already present.
 * - For local: delegate to base.deleteEvent (callers can choose scope; we use 'series' here).
 */
export function deleteEvent(idOrEvt: string | EventRecord) {
  let evt: EventRecord | undefined
  if (typeof idOrEvt === 'string') {
    // resolve into a shadow if the id belongs to a shadow; otherwise leave undefined
    evt = readShadows().find(s => s.id === idOrEvt) as EventRecord | undefined
  } else {
    evt = idOrEvt
  }

  if (evt && (isExternal(evt) || isShadow(evt))) {
    const origStart = (evt as any)._prevStart || evt.start
    const candidate = { ...(evt as any), start: origStart }
    const key = toExtKey(candidate) || (evt as any).extKey || null
    if (key) {
      const remaining = readShadows().filter(s => s.extKey !== key)
      writeShadows(remaining)
      return
    }
  }

  if (evt) base.deleteEvent(evt, 'series')
}

/* ---------------------------- optional subscriptions ---------------------------- */
/**
 * Consumers generally listen to 'fc:events-changed' and rerun their selectors.
 * If you need a subscription API, you can expose one here.
 */
export function subscribe(handler: () => void) {
  const h = () => handler()
  window.addEventListener('fc:events-changed', h)
  return () => window.removeEventListener('fc:events-changed', h)
}
