// frontend/src/sync/google.ts
// Google Calendar adapter: incremental pull (instances) + real push (create/update/delete)

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult, LocalEvent } from './types'
import { getAccessToken } from '../google/oauth'

type GoogleEvent = {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  colorId?: string
  updated?: string
  recurringEventId?: string
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string }
  recurrence?: string[]
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { email?: string; displayName?: string }[]
  etag?: string
}

type ListResp = {
  items?: GoogleEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

function toISO(z: string | undefined) {
  if (!z) return undefined
  const d = new Date(z)
  return isNaN(+d) ? undefined : d.toISOString()
}

function mapGoogleToLocal(g: GoogleEvent) {
  // Cancelled events are represented as 'delete' by caller
  const isAllDay = !!g.start?.date && !!g.end?.date

  const startISO = isAllDay
    ? toISO(`${g.start!.date}T00:00:00Z`)
    : toISO(g.start?.dateTime)

  // Google all-day end is exclusive → subtract 1ms so it finishes “today 23:59:59.999”
  const endExclusiveISO = isAllDay
    ? toISO(`${g.end!.date}T00:00:00Z`)
    : toISO(g.end?.dateTime)

  if (!startISO || !endExclusiveISO) return null
  const endISO = isAllDay
    ? new Date(new Date(endExclusiveISO).getTime() - 1).toISOString()
    : endExclusiveISO

  const rrule = Array.isArray(g.recurrence)
    ? g.recurrence.find(x => x.toUpperCase().startsWith('RRULE:'))
    : undefined

  const attendees = Array.isArray(g.attendees)
    ? g.attendees.map(a => a?.email || a?.displayName || '').filter(Boolean)
    : undefined

  return {
    id: g.id, // instance id (unique per occurrence)
    title: g.summary || '(No title)',
    start: startISO,
    end: endISO,
    allDay: isAllDay || undefined,
    location: g.location || undefined,
    notes: g.description || undefined,
    attendees,
    rrule: rrule ? rrule.replace(/^RRULE:/i, '') : undefined,
    colour: undefined,
    _remote: [{
      provider: 'google',
      calendarId: '', // filled by caller
      externalId: g.id,
      etag: g.etag,
    }],
  }
}

async function gfetchJSON<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('401')
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new Error('401')
  if (res.status === 409) throw new Error('409')
  if (res.status === 429) throw new Error('429')
  if (res.status === 410) throw new Error('410')
  if (res.status === 400) throw new Error('400')
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

async function gfetchBody<T = any>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: any): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('401')
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 412) throw new Error('412') // Precondition failed (etag)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}:${text}`)
  }
  // some endpoints return 204 no content
  try { return (await res.json()) as T } catch { return undefined as any }
}

/** detect an all-day by “full-day span” and midnight alignment */
function isAllDayLocal(ev: LocalEvent): boolean {
  try {
    const s = new Date(ev.start)
    const e = new Date(ev.end)
    if (isNaN(+s) || isNaN(+e)) return !!ev.allDay
    const dur = e.getTime() - s.getTime()
    const oneDay = 24 * 60 * 60 * 1000
    const startsMidnight = s.getUTCHours() === 0 && s.getUTCMinutes() === 0 && s.getUTCSeconds() === 0
    // tolerate either classic inclusive (23:59:59.999) or exclusive midnight end-1ms
    const endsMidnightMinus = (e.getUTCHours() === 23 && e.getUTCMinutes() === 59) || (e.getUTCHours() === 0 && dur % oneDay === 0)
    return ev.allDay || (startsMidnight && endsMidnightMinus)
  } catch {
    return !!ev.allDay
  }
}

function toGoogleBody(ev: LocalEvent, tz?: string) {
  const allDay = isAllDayLocal(ev)
  const s = new Date(ev.start)
  const e = new Date(ev.end)
  if (isNaN(+s) || isNaN(+e)) throw new RangeError('Invalid Date')
  if (allDay) {
    // Convert inclusive end → exclusive date
    // The "end date" in Google is the day AFTER the last full day
    const endExclusive = new Date(e.getTime() + 1) // if already exclusive midnight-1ms, +1ms lands on midnight
    const endDate = new Date(Date.UTC(endExclusive.getUTCFullYear(), endExclusive.getUTCMonth(), endExclusive.getUTCDate()))
    const startDate = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`
    return {
      summary: ev.title || '(No title)',
      description: ev.notes || '',
      location: ev.location || undefined,
      start: { date: dateStr(startDate) },
      end: { date: dateStr(endDate) },
    }
  } else {
    return {
      summary: ev.title || '(No title)',
      description: ev.notes || '',
      location: ev.location || undefined,
      start: { dateTime: new Date(ev.start).toISOString(), timeZone: tz || undefined },
      end: { dateTime: new Date(ev.end).toISOString(), timeZone: tz || undefined },
    }
  }
}

export function createGoogleAdapter(opts: { accountKey?: string; calendars?: string[] }): ProviderAdapter {
  const calendars = opts.calendars && opts.calendars.length ? opts.calendars : ['primary']

  return {
    provider: 'google',

    async pull({ sinceToken, rangeStartISO, rangeEndISO }) {
      const events: RemoteDelta[] = []
      let nextSyncToken: string | null = null

      for (const calId of calendars) {
        let pageToken: string | undefined
        let useSyncToken = !!sinceToken

        while (true) {
          const params: Record<string, string> = {
            maxResults: '2500',
            showDeleted: 'true',
            singleEvents: 'true',
          }
          if (useSyncToken && sinceToken) {
            params.syncToken = sinceToken
          } else {
            params.orderBy = 'startTime' // allowed only without syncToken
            // normalize to RFC3339 and ensure timeMax > timeMin
            const tmin = new Date(rangeStartISO).toISOString()
            const tmax0 = new Date(rangeEndISO).toISOString()
            const tmax = (new Date(tmax0).getTime() <= new Date(tmin).getTime())
              ? new Date(new Date(tmin).getTime() + 60_000).toISOString()
              : tmax0
            params.timeMin = tmin
            params.timeMax = tmax
          }
          if (pageToken) params.pageToken = pageToken

          let data: ListResp
          try {
            data = await gfetchJSON<ListResp>(`/calendars/${encodeURIComponent(calId)}/events`, params)
          } catch (e: any) {
            const code = e?.message
            // Invalid/expired sync token or bad param → restart in window mode
            if (code === '409' || code === '410' || code === '400') {
              useSyncToken = false
              pageToken = undefined
              continue
            }
            if (code === '429') {
              await new Promise(r => setTimeout(r, 800))
              continue
            }
            throw e
          }

          const items = Array.isArray(data.items) ? data.items : []
          for (const g of items) {
            const isMaster = Array.isArray(g.recurrence) && g.recurrence.length > 0 && !g.originalStartTime
            if (isMaster) continue

            if (g.status === 'cancelled') {
              events.push({
                operation: 'delete',
                calendarId: calId,
                externalId: g.id,
              })
              continue
            }

            const payload = mapGoogleToLocal(g)
            if (!payload) continue
            if (payload._remote && payload._remote[0]) payload._remote[0].calendarId = calId

            events.push({
              operation: 'upsert',
              calendarId: calId,
              externalId: g.id,
              etag: g.etag,
              payload,
            })
          }

          if (data.nextPageToken) { pageToken = data.nextPageToken; continue }
          nextSyncToken = data.nextSyncToken || nextSyncToken
          break
        }
      }

      return { token: nextSyncToken || sinceToken || null, events }
    },

    // ============== PUSH (create/update/delete) ==============
    async push(intents: PushIntent[]) {
      const results: PushResult[] = []
      if (!intents || intents.length === 0) return results

      // We’ll act only on entries that are either:
      //  - already bound to Google (_remote has provider "google"), or
      //  - clearly local/unbound (no _remote at all) — we create on first calendar
      for (const it of intents) {
        const ev = it.local as LocalEvent
        const remote = Array.isArray((ev as any)._remote) ? (ev as any)._remote as Array<any> : []
        const boundGoogle = remote.find(r => r?.provider === 'google')
        const calendarId = (boundGoogle?.calendarId) || (calendars[0] || 'primary')

        try {
          if (it.action === 'delete') {
            if (!boundGoogle?.externalId) {
              // nothing to do; treat as success to drain the journal
              results.push({ ok: true, action: it.action, localId: ev.id })
              continue
            }
            await gfetchBody('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(boundGoogle.externalId)}`)
            results.push({ ok: true, action: 'delete', localId: ev.id })
            continue
          }

          // create or update payload
          const body = toGoogleBody(ev, (ev as any).timezone)

          if (!boundGoogle) {
            // CREATE
            const created = await gfetchBody<GoogleEvent>('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, body)
            results.push({
              ok: true,
              action: 'create',
              localId: ev.id,
              bound: {
                provider: 'google',
                calendarId,
                externalId: created.id,
                etag: created.etag,
              },
            })
          } else {
            // UPDATE (use etag for optimistic concurrency if we have it)
            const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(boundGoogle.externalId)}`
            const updated = await gfetchBody<GoogleEvent>('PATCH', path, body)
            results.push({
              ok: true,
              action: 'update',
              localId: ev.id,
              bound: {
                provider: 'google',
                calendarId,
                externalId: updated.id,
                etag: updated.etag,
              },
            })
          }
        } catch (err: any) {
          console.warn('[google.push] failed', err)
          results.push({ ok: false, action: it.action, localId: ev.id, error: String(err?.message || err) })
        }
      }

      return results
    },
  }
}
