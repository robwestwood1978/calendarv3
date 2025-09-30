// frontend/src/lib/recurrence.ts
import { DateTime, Interval } from 'luxon'

export interface EventRecord {
  id?: string
  title: string
  location?: string
  notes?: string
  start: string
  end: string
  allDay?: boolean
  tags: string[]
  checklist: string[]
  attendees?: string[]
  colour?: string
  rrule?: string
  exdates?: string[]
  overrides?: Record<string, Partial<EventRecord>>
  _anchor?: string
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const MAX_OCCURRENCES = 1000 // safety cap

export function makeOverrideKey(dt: DateTime): string {
  return dt.toFormat('yyyyLLdd')
}

export function expandRecurring(e: EventRecord, viewStart: DateTime, viewEnd: DateTime): EventRecord[] {
  if (!e.rrule) return intersects(e, viewStart, viewEnd) ? [e] : []

  const baseStart = DateTime.fromISO(e.start)
  const baseEnd = DateTime.fromISO(e.end)
  if (!baseStart.isValid || !baseEnd.isValid) return []

  const duration = baseEnd.diff(baseStart)
  const { freq, interval, byday, until, count } = parseRRule(e.rrule, baseStart)
  const ex = new Set((e.exdates || []).map(s => s.trim()))
  const out: EventRecord[] = []
  let occurrences = 0

  const pushOcc = (occStart: DateTime) => {
    if (occurrences >= MAX_OCCURRENCES) return
    const key = makeOverrideKey(occStart)
    const ov = e.overrides?.[key]

    if (ov) {
      const useStart = ov.start ? DateTime.fromISO(ov.start) : occStart
      const useEnd = ov.end ? DateTime.fromISO(ov.end) : useStart.plus(duration)
      if (!useStart.isValid || !useEnd.isValid) return
      const inst: EventRecord = { ...e, ...ov, start: useStart.toISO()!, end: useEnd.toISO()!, _anchor: e.start }
      if (intersects(inst, viewStart, viewEnd)) out.push(inst)
      occurrences++
      return
    }

    if (ex.has(key)) return

    const inst: EventRecord = { ...e, start: occStart.toISO()!, end: occStart.plus(duration).toISO()!, _anchor: e.start }
    if (intersects(inst, viewStart, viewEnd)) out.push(inst)
    occurrences++
  }

  if (freq === 'DAILY') {
    for (let d = baseStart; withinUntil(d, until) && withinCount(occurrences, count) && occurrences < MAX_OCCURRENCES; d = d.plus({ days: interval })) {
      if (d < baseStart) continue
      pushOcc(d)
    }
    return out
  }

  if (freq === 'WEEKLY') {
    const days = byday.length ? byday : [WEEKDAY_CODES[baseStart.weekday - 1]]
    let cursor = baseStart.startOf('week')
    while (withinUntil(cursor, until) && withinCount(occurrences, count) && occurrences < MAX_OCCURRENCES) {
      for (const code of days) {
        const idx = WEEKDAY_CODES.indexOf(code); if (idx === -1) continue
        const occ = cursor.plus({ days: idx }).set({ hour: baseStart.hour, minute: baseStart.minute, second: baseStart.second, millisecond: baseStart.millisecond })
        if (occ < baseStart) continue
        if (!withinUntil(occ, until)) continue
        pushOcc(occ)
        if (!withinCount(occurrences, count) || occurrences >= MAX_OCCURRENCES) break
      }
      cursor = cursor.plus({ weeks: interval })
    }
    return out
  }

  if (freq === 'MONTHLY') {
    let d = baseStart
    while (withinUntil(d, until) && withinCount(occurrences, count) && occurrences < MAX_OCCURRENCES) {
      if (d >= baseStart) pushOcc(d)
      d = d.plus({ months: interval })
    }
    return out
  }

  if (freq === 'YEARLY') {
    let d = baseStart
    while (withinUntil(d, until) && withinCount(occurrences, count) && occurrences < MAX_OCCURRENCES) {
      if (d >= baseStart) pushOcc(d)
      d = d.plus({ years: interval })
    }
    return out
  }

  return intersects(e, viewStart, viewEnd) ? [e] : []
}

export function applyOverrides(e: EventRecord): EventRecord {
  if (!e.overrides) return e
  const key = makeOverrideKey(DateTime.fromISO(e.start))
  const o = e.overrides[key]
  return o ? { ...e, ...o } : e
}

function intersects(e: EventRecord, a: DateTime, b: DateTime): boolean {
  const s = DateTime.fromISO(e.start)
  const eEnd = DateTime.fromISO(e.end)
  if (!s.isValid || !eEnd.isValid) return false
  return Interval.fromDateTimes(a, b).overlaps(Interval.fromDateTimes(s, eEnd))
}
function withinUntil(d: DateTime, until: DateTime | null): boolean { return !until || d <= until }
function withinCount(i: number, count: number): boolean { return count === 0 || i < count }

type ParsedRRule = { freq: 'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY'; interval: number; byday: string[]; until: DateTime | null; count: number }
function parseRRule(rrule: string, dtStart: DateTime): ParsedRRule {
  const up = (rrule || '').toUpperCase()
  const freq = (up.match(/FREQ=([A-Z]+)/)?.[1] || 'WEEKLY') as ParsedRRule['freq']
  const interval = Math.max(1, parseInt(up.match(/INTERVAL=(\d+)/)?.[1] || '1', 10))
  const byday = up.match(/BYDAY=([A-Z,]+)/)?.[1]?.split(',') ?? []
  const untilStr = up.match(/UNTIL=([0-9T]+)/)?.[1]
  const count = parseInt(up.match(/COUNT=(\d+)/)?.[1] || '0', 10)

  let until: DateTime | null = null
  if (untilStr) {
    // accept both yyyymmddThhmmss and yyyymmdd
    const a = DateTime.fromFormat(untilStr, "yyyyLLdd'T'HHmmss")
    const b = DateTime.fromFormat(untilStr, 'yyyyLLdd')
    until = a.isValid ? a : (b.isValid ? b.endOf('day') : null)
  }

  const finalByDay = (freq === 'WEEKLY' && byday.length === 0)
    ? ['MO','TU','WE','TH','FR','SA','SU'][dtStart.weekday - 1]
    : byday

  return { freq, interval, byday: Array.isArray(finalByDay) ? finalByDay : [finalByDay], until, count }
}
