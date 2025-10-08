import { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'
import * as base from './events'
import { externalExpanded, listCalendars } from './integrations'
import { isExternal, isShadow, toExtKey } from '../lib/external'

const LS_SHADOWS = 'fc_shadow_events_v1'

function emitChanged() { try { window.dispatchEvent(new Event('fc:events-changed')) } catch {} }
function toast(msg: string) { try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {} }
function safeParse<T>(raw: string | null, fallback: T): T { if (!raw) return fallback; try { return JSON.parse(raw) as T } catch { return fallback } }

/* ---------------- shadows ---------------- */
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

/* ---------------- reads ---------------- */
export function listExpanded(viewStart: DateTime, viewEnd: DateTime, query?: string): EventRecord[] {
  const locals = base.listExpanded(viewStart, viewEnd, query)
  const external = externalExpanded(viewStart, viewEnd, query) || []

  const sMap = shadowMap()
  const mergedExternal = external.map((occ) => {
    const key = toExtKey(occ)
    if (key && sMap.has(key)) {
      const sh = sMap.get(key)!
      return { ...occ, ...sh, source: 'shadow' } as EventRecord
    }
    return occ
  })

  const all = [...locals, ...mergedExternal]
  const q = (query || '').trim().toLowerCase()
  const filtered = q ? all.filter(e => matchQuery(e, q)) : all
  return filtered.sort((a, b) => a.start.localeCompare(b.start) || (a.title || '').localeCompare(b.title || ''))
}

function matchQuery(e: EventRecord, q: string): boolean {
  const hay = [
    e.title, e.location, e.notes,
    ...(e.tags || []),
    ...(e.attendees || []),
    ...(e.checklist || []),
  ].join(' ').toLowerCase()
  return hay.includes(q)
}

/* ---------------- writes ---------------- */
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
    return evt
  }

  // Local
  base.upsertEvent(evt, 'series')
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
      return
    }
  }

  if (evt) base.deleteEvent(evt, 'series')
}
