// frontend/src/state/events.ts
import { DateTime } from 'luxon'
import { expandRecurring, applyOverrides, makeOverrideKey, EventRecord } from '../lib/recurrence'
import { useEffect, useMemo, useState } from 'react'

export type EditMode = 'single' | 'following' | 'series'
const LS_EVENTS = 'fc_events_v1'

function emitChange() { try { window.dispatchEvent(new Event('fc:events-changed')) } catch {} }

export function loadEvents(): EventRecord[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(LS_EVENTS)
  let arr: any[] = []
  try { arr = raw ? JSON.parse(raw) : [] } catch { arr = [] }
  const safe = (arr as any[]).filter((e) => {
    const s = e?.start && typeof e.start === 'string' ? DateTime.fromISO(e.start) : null
    const en = e?.end && typeof e.end === 'string' ? DateTime.fromISO(e.end) : null
    return !!(s?.isValid && en?.isValid)
  }).map((e) => normalizeEvent(e as EventRecord))
  if (raw && safe.length !== (arr?.length || 0)) { try { localStorage.setItem(LS_EVENTS, JSON.stringify(safe)) } catch {} }
  return safe
}

export function saveEvents(evts: EventRecord[]) { localStorage.setItem(LS_EVENTS, JSON.stringify(evts)); emitChange() }

export function listExpanded(viewStart: DateTime, viewEnd: DateTime, query?: string): EventRecord[] {
  const base = loadEvents()
  const expanded = base.flatMap(e => expandRecurring(e, viewStart, viewEnd))
  const withOverrides = expanded.map(e => applyOverrides(e))
  const filtered = query?.trim() ? withOverrides.filter(e => matchQuery(e, query!)) : withOverrides
  return filtered.sort((a, b) => a.start.localeCompare(b.start) || (a.title || '').localeCompare(b.title || ''))
}

/** Match title, location, notes, tags, attendees, checklist (what to bring) */
export function matchQuery(e: EventRecord, q: string): boolean {
  const hay = [
    e.title, e.location, e.notes,
    ...(e.tags || []),
    ...(e.attendees || []),
    ...(e.checklist || []),
  ].join(' ').toLowerCase()
  return hay.includes((q || '').toLowerCase())
}

/* ----------------------------- mutations ---------------------------------- */

export function upsertEvent(e: EventRecord, mode: EditMode): void {
  const all = loadEvents()
  const idx = e.id ? all.findIndex(x => x.id === e.id) : -1
  if (!e.id) e.id = `e_${Date.now()}_${Math.random().toString(36).slice(2)}`

  // Entire series: merge into base
  if (!e.rrule || mode === 'series') {
    if (idx >= 0) {
      const prev = all[idx]
      all[idx] = normalizeEvent({
        ...prev,
        title: e.title, location: e.location, notes: e.notes,
        start: e.start, end: e.end, allDay: e.allDay,
        rrule: e.rrule, tags: e.tags, checklist: e.checklist, attendees: e.attendees, colour: e.colour,
        exdates: e.exdates ?? prev.exdates,
        overrides: e.overrides ?? prev.overrides,
      })
    } else {
      all.push(normalizeEvent(e))
    }
    saveEvents(all)
    return
  }

  const baseEvt = idx >= 0 ? all[idx] : undefined
  if (!baseEvt) { all.push(normalizeEvent(e)); saveEvents(all); return }

  const occKey = makeOverrideKey(DateTime.fromISO(e.start))

  if (mode === 'single') {
    baseEvt.overrides = baseEvt.overrides || {}
    baseEvt.overrides[occKey] = {
      title: e.title, location: e.location, notes: e.notes,
      start: e.start, end: e.end, allDay: e.allDay,
      tags: e.tags, checklist: e.checklist, attendees: e.attendees, colour: e.colour,
    }
    baseEvt.exdates = baseEvt.exdates || []
    if (!baseEvt.exdates.includes(occKey)) baseEvt.exdates.push(occKey)
    all[idx] = normalizeEvent(baseEvt)
    saveEvents(all)
    return
  }

  if (mode === 'following') {
    const splitStart = DateTime.fromISO(e.start)
    const untilStr = formatUntil(splitStart.minus({ seconds: 1 }))
    const old = { ...baseEvt }

    // Cap the old series at the split boundary AND exclude the split instance explicitly
    old.rrule = upsertUntil(old.rrule || '', untilStr)
    old.exdates = old.exdates || []
    if (!old.exdates.includes(occKey)) old.exdates.push(occKey)

    const newSeries: EventRecord = normalizeEvent({
      ...e,
      id: `e_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      overrides: {},
      exdates: [],
      rrule: rebuildRRuleFrom(baseEvt.rrule || '', splitStart),
    })

    all[idx] = normalizeEvent(old)
    all.push(newSeries)
    saveEvents(all)
    return
  }
}

export function deleteEvent(e: EventRecord, mode: EditMode) {
  const all = loadEvents()
  const idx = e.id ? all.findIndex(x => x.id === e.id) : -1
  if (idx < 0) return

  if (!e.rrule || mode === 'series') {
    all.splice(idx, 1)
    saveEvents(all)
    return
  }

  const occKey = makeOverrideKey(DateTime.fromISO(e.start))
  all[idx].exdates = all[idx].exdates || []
  if (!all[idx].exdates!.includes(occKey)) all[idx].exdates!.push(occKey)
  saveEvents(all)
}

/* ----------------------------- helpers ---------------------------------- */

function normalizeEvent(e: EventRecord): EventRecord {
  return {
    ...e,
    title: e.title || '(untitled)',
    tags: e.tags || [],
    checklist: e.checklist || [],
    attendees: e.attendees || [],
    exdates: e.exdates || [],
    overrides: e.overrides || {},
  }
}

function rebuildRRuleFrom(rr: string, dtStart: DateTime): string {
  const up = rr.toUpperCase()
  const freq = up.match(/FREQ=([A-Z]+)/)?.[1] || 'WEEKLY'
  const interval = up.match(/INTERVAL=(\d+)/)?.[1] || '1'
  const byday = up.match(/BYDAY=([A-Z,]+)/)?.[1]
  const parts = [`FREQ=${freq}`, `INTERVAL=${interval}`]
  if (freq === 'WEEKLY') {
    const fallback = ['MO','TU','WE','TH','FR','SA','SU'][dtStart.weekday - 1]
    const wd = byday ? byday : fallback
    parts.push(`BYDAY=${wd}`)
  }
  return parts.join(';')
}

function upsertUntil(rr: string, until: string): string {
  const up = (rr || '').toUpperCase()
  if (!up) return `FREQ=WEEKLY;INTERVAL=1;UNTIL=${until}`
  if (/UNTIL=/.test(up)) return up.replace(/UNTIL=[0-9T]+/, `UNTIL=${until}`)
  return `${up};UNTIL=${until}`
}

function formatUntil(dt: DateTime): string { return dt.toFormat("yyyyLLdd'T'HHmmss") }

/* ----------------- legacy hook ---------------- */
export function useEvents(args?: { start?: DateTime; end?: DateTime; query?: string }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(x => x + 1)
    window.addEventListener('storage', bump)
    window.addEventListener('fc:events-changed', bump)
    return () => { window.removeEventListener('storage', bump); window.removeEventListener('fc:events-changed', bump) }
  }, [])
  const events = useMemo(() => {
    if (args?.start && args?.end) return listExpanded(args.start, args.end, args.query)
    return loadEvents()
  }, [args?.start?.toISO(), args?.end?.toISO(), args?.query, tick])
  return { events, upsertEvent, deleteEvent }
}
