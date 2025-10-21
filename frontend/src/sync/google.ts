// Google Calendar adapter: windowed pull (instances) + safe push (idempotent create/update/delete)
// - Prevents duplicates using extendedProperties.private.fc_local_id
// - Maps all-day correctly (inclusive local → exclusive end.date on Google)
// - Retries PATCH on 412 (stale etag)
// - Rejects invalid dates with clear log (and marks push as failed so journal can be inspected)

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
  extendedProperties?: {
    private?: Record<string, string>
    shared?: Record<string, string>
  }
}

type ListResp = {
  items?: GoogleEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

const MARKER_KEY = 'fc_local_id' // used in extendedProperties.private

/* ---------------- utilities ---------------- */

function toISO(z: string | undefined) {
  if (!z) return undefined
  const d = new Date(z)
  return isNaN(+d) ? undefined : d.toISOString()
}

function isValidISO(s?: string) {
  if (!s) return false
  const d = new Date(s)
  return !isNaN(+d)
}

function mapGoogleToLocal(g: GoogleEvent, calId: string) {
  const isAllDay = !!g.start?.date && !!g.end?.date

  const startISO = isAllDay
    ? toISO(`${g.start!.date}T00:00:00Z`)
    : toISO(g.start?.dateTime)

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
    id: g.id, // instance id
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
      calendarId: calId,
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

async function gfetchBody<T = any>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: any, etag?: string): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('401')
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (etag) headers['If-Match'] = etag

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 412) throw new Error('412') // Precondition failed (etag)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}:${text}`)
  }
  try { return (await res.json()) as T } catch { return undefined as any }
}

/** detect all-day by midnight alignment and full-day span */
function isAllDayLocal(ev: LocalEvent): boolean {
  if (ev.allDay) return true
  if (!isValidISO(ev.start) || !isValidISO(ev.end)) return false
  const s = new Date(ev.start!)
  const e = new Date(ev.end!)
  const startsMidnight = s.getUTCHours() === 0 && s.getUTCMinutes() === 0 && s.getUTCSeconds() === 0
  // allow inclusive end (…:59.999) or exact-day multiples ending at 00:00 next day minus 1ms
  const endsAt59 = e.getUTCHours() === 23 && e.getUTCMinutes() === 59
  const ms = e.getTime() - s.getTime() + 1 // inclusive window
  const isWholeDays = ms % (24 * 60 * 60 * 1000) === 0
  return startsMidnight && (endsAt59 || isWholeDays)
}

function toGoogleBody(ev: LocalEvent, tz?: string) {
  if (!isValidISO(ev.start) || !isValidISO(ev.end)) {
    throw new RangeError('Invalid Date')
  }
  const allDay = isAllDayLocal(ev)
  const s = new Date(ev.start!)
  const e = new Date(ev.end!)

  if (allDay) {
    // Inclusive local end → exclusive Google end.date (next day)
    const endExclusive = new Date(e.getTime() + 1)
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
      start: { dateTime: new Date(ev.start!).toISOString(), timeZone: tz || undefined },
      end: { dateTime: new Date(ev.end!).toISOString(), timeZone: tz || undefined },
    }
  }
}

/** find an existing Google event by our private local-id marker */
async function findByMarker(calendarId: string, localId: string): Promise<GoogleEvent | null> {
  try {
    const q = encodeURIComponent(`${MARKER_KEY}=${localId}`)
    // Extended properties are not searchable via free-text; we fetch a small window instead.
    // Fallback: list last 2 weeks → + 1 year to keep API calls bounded for creation/update flows.
    const now = new Date()
    const timeMin = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()

    let pageToken: string | undefined
    for (let guard = 0; guard < 4; guard++) {
      const resp = await gfetchJSON<ListResp>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        singleEvents: 'true',
        showDeleted: 'false',
        timeMin,
        timeMax,
        maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      })
      const items = resp.items || []
      for (const g of items) {
        const mark = g.extendedProperties?.private?.[MARKER_KEY]
        if (mark === localId) return g
      }
      if (!resp.nextPageToken) break
      pageToken = resp.nextPageToken
    }
    return null
  } catch {
    return null
  }
}

/* ---------------- adapter ---------------- */

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
            params.orderBy = 'startTime' // only when not using syncToken
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

            const payload = mapGoogleToLocal(g, calId)
            if (!payload) continue

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

    async push(intents: PushIntent[]) {
      const results: PushResult[] = []
      if (!intents?.length) return results

      for (const it of intents) {
        const ev = it.local as LocalEvent
        const remote = Array.isArray((ev as any)._remote) ? (ev as any)._remote as Array<any> : []
        const boundGoogle = remote.find(r => r?.provider === 'google')
        const calendarId = (boundGoogle?.calendarId) || (calendars[0] || 'primary')

        try {
          if (it.action === 'delete') {
            if (boundGoogle?.externalId) {
              await gfetchBody('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(boundGoogle.externalId)}`)
            } else {
              // try locate by marker and delete that
              const found = ev.id ? await findByMarker(calendarId, ev.id) : null
              if (found) {
                await gfetchBody('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(found.id)}`)
              }
            }
            results.push({ ok: true, action: 'delete', localId: ev.id })
            continue
          }

          // CREATE or UPDATE
          const body = toGoogleBody(ev, (ev as any).timezone)

          // always carry our idempotency marker
          (body as any).extendedProperties = (body as any).extendedProperties || {}
          ;(body as any).extendedProperties.private = {
            ...(body as any).extendedProperties.private,
            [MARKER_KEY]: ev.id,
          }

          if (!boundGoogle?.externalId) {
            // try to find an existing event created earlier with our marker
            const existing = ev.id ? await findByMarker(calendarId, ev.id) : null
            if (existing) {
              // PATCH existing instead of creating a dupe
              const updated = await gfetchBody<GoogleEvent>(
                'PATCH',
                `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing.id)}`,
                body,
                existing.etag
              )
              results.push({
                ok: true,
                action: 'update',
                localId: ev.id,
                bound: { provider: 'google', calendarId, externalId: updated.id, etag: updated.etag },
              })
            } else {
              // CREATE
              const created = await gfetchBody<GoogleEvent>(
                'POST',
                `/calendars/${encodeURIComponent(calendarId)}/events`,
                body
              )
              results.push({
                ok: true,
                action: 'create',
                localId: ev.id,
                bound: { provider: 'google', calendarId, externalId: created.id, etag: created.etag },
              })
            }
          } else {
            // UPDATE via PATCH (retry once without If-Match on 412)
            const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(boundGoogle.externalId)}`
            try {
              const updated = await gfetchBody<GoogleEvent>('PATCH', path, body, boundGoogle.etag)
              results.push({
                ok: true,
                action: 'update',
                localId: ev.id,
                bound: { provider: 'google', calendarId, externalId: updated.id, etag: updated.etag },
              })
            } catch (err: any) {
              if (String(err?.message || '').startsWith('412')) {
                const updated = await gfetchBody<GoogleEvent>('PATCH', path, body /* no etag */)
                results.push({
                  ok: true,
                  action: 'update',
                  localId: ev.id,
                  bound: { provider: 'google', calendarId, externalId: updated.id, etag: updated.etag },
                })
              } else {
                throw err
              }
            }
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
