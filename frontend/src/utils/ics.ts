// Tolerant ICS parser for Apple/Google ICS feeds.
// Produces EventRecord-like objects, including allDay, RRULE, EXDATE.

import { DateTime } from 'luxon'
import type { EventRecord } from '../lib/recurrence'

type RawEvent = { [k: string]: string | string[] }

function unfold(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1)
    else out.push(line)
  }
  return out
}

function parse(text: string): RawEvent[] {
  const lines = unfold(text)
  const events: RawEvent[] = []
  let cur: RawEvent | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (line === 'BEGIN:VEVENT') { cur = {}; continue }
    if (line === 'END:VEVENT')   { if (cur) events.push(cur); cur = null; continue }
    if (!cur) continue
    const idx = line.indexOf(':'); if (idx === -1) continue
    const left = line.slice(0, idx); const right = line.slice(idx + 1)
    const [prop, ...params] = left.split(';'); const key = prop.toUpperCase()
    const value = right
    if (cur[key]) {
      const prev = cur[key]
      if (Array.isArray(prev)) (prev as string[]).push(value)
      else cur[key] = [prev as string, value]
    } else cur[key] = value
    for (const p of params) {
      const [k, v] = p.split('=')
      if (k && v) cur[`${key};${k.toUpperCase()}`] = v.toUpperCase()
    }
  }
  return events
}

function parseDate(value: string, tzHint?: string | null): { iso: string, allDay: boolean } | null {
  if (!value) return null
  if (/^\d{8}$/.test(value)) { // DATE only
    const dt = DateTime.fromFormat(value, 'yyyyLLdd', { zone: 'utc' })
    if (!dt.isValid) return null
    return { iso: dt.toISO()!, allDay: true }
  }
  const z = value.endsWith('Z')
  const fmt = "yyyyLLdd'T'HHmmss"
  const dt = DateTime.fromFormat(z ? value.slice(0,-1) : value, fmt, { zone: z ? 'utc' : (tzHint || 'local') })
  if (!dt.isValid) return null
  return { iso: dt.toISO()!, allDay: false }
}

export function icsToEvents(text: string, calendarId: string, color?: string): EventRecord[] {
  const raws = parse(text)
  const out: EventRecord[] = []
  for (const ev of raws) {
    const sum = String(ev['SUMMARY'] || '').trim()
    const loc = String(ev['LOCATION'] || '').trim()
    const desc = String(ev['DESCRIPTION'] || '').trim()
    const uid = String(ev['UID'] || '').trim() || `ics_${calendarId}_${Math.random().toString(36).slice(2)}`
    const tz = (ev['DTSTART;TZID'] as string) || null

    const dtStartRaw = String(ev['DTSTART'] || '')
    const dtEndRaw = String(ev['DTEND'] || '')
    const rrule = String(ev['RRULE'] || '').trim()

    const start = parseDate(dtStartRaw, tz); if (!start) continue
    const end   = parseDate(dtEndRaw, tz)

    const endIso = end
      ? end.iso
      : (start.allDay
        ? DateTime.fromISO(start.iso).plus({ days: 1 }).toISO()
        : DateTime.fromISO(start.iso).plus({ hours: 1 }).toISO())

    const exRaw = ev['EXDATE']
    const exdates: string[] = []
    const collect = (s: string) => {
      for (const p of s.split(',').filter(Boolean)) { const d = parseDate(p, tz); if (d) exdates.push(d.iso) }
    }
    if (Array.isArray(exRaw)) exRaw.forEach(collect)
    else if (typeof exRaw === 'string' && exRaw) collect(exRaw)

    const rec: EventRecord = {
      id: `ext:${calendarId}:${uid}`,
      title: sum || '(no title)',
      location: loc || undefined,
      notes: desc || undefined,
      start: start.iso,
      end: endIso!,
      allDay: start.allDay || undefined,
      tags: ['external'],
      checklist: [],
      colour: color,
      rrule: rrule || undefined,
      exdates: exdates.length ? exdates : undefined,
      // soft hints for agenda merge
      // @ts-ignore
      _origin: 'external',
      // @ts-ignore
      _calendarId: calendarId,
    }
    out.push(rec)
  }
  return out
}
