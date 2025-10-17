// frontend/src/sync/google.ts
// Google Calendar adapter: incremental pull (expanded instances) + push (create/update/delete)

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
    id: g.id, // instance id (unique per occurrence when singleEvents=true)
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

async function gfetchBody<T = any>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: any, etag?: string): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('401')
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  // Use If-Match when updating to avoid stomping concurrent edits
  if (method === 'PATCH' && etag) headers['If-Match'] = etag

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  // 412 → ETag mismatch; let caller decide (we’ll treat as soft failure)
  if (res.status === 412) throw new Error('412:Precondition failed (etag mismatch)')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}:${text}`)
  }
  try { return (await res.json()) as T } catch { return undefined as any }
}

/** detect an all-day by “full-day span” and midnight alignment in UTC */
function isAllDayLocal(ev: LocalEvent): boolean {
  try {
    const s = new Date(ev.start)
    const e = new Date(ev.end)
    if (isNaN(+s) || isNaN(+e)) return !!ev.allDay
    const startsMidnightUTC = s.getUTCHours() === 0 && s.getUTCMinutes() === 0 && s.getUTCSeconds() === 0
    const endsAtEndOfDayUTC = (e.getUTCHours() === 23 && e.getUTCMinutes() === 59) ||
                              (e.getUTCHours() === 23 && e.getUTCMinutes() === 59 && e.getUTCSeconds() === 59)
    const isFlagged = !!ev.allDay
    return isFlagged || (startsMidnightUTC && endsAtEndOfDayUTC)
  } catch { return !!ev.allDay }
}

/** Build Google API event body from a LocalEvent */
function toGoogleBody(ev: LocalEvent, tz?: string) {
  // Validate dates once; skip pushing malformed events rather than throwing
  const sNum = Date.parse(ev.start as any)
  const eNum = Date.parse(ev.end as any)
  if (!isFinite(sNum) || !isFinite(eNum)) {
    throw new RangeError('Invalid Date')
  }

  const allDay = isAllDayLocal(ev)
  if (allDay) {
    // Inclusive end (…23:59:59.999) → Google exclusive end date (next day)
    const s = new Date(sNum)
    const e = new Date(eNum)
    const endExclusiveUTC = new Date(e.getTime() + 1) // +1ms pushes to next midnight boundary in UTC
    const startDate = `${s.getUTCFullYear()}-${String(s.getUTCMonth()+1).padStart(2,'0')}-${String(s.getUTCDate()).padStart(2,'0')}`
    const endDate   = `${endExclusiveUTC.getUTCFullYear()}-${String(endExclusiveUTC.getUTCMonth()+1).padStart(2,'0')}-${String(endExclusiveUTC.getUTCDate()).padStart(2,'0')}`
    return {
      summary: ev.title || '(No title)',
      description: ev.notes || '',
      location: ev.location || undefined,
      start: { date: startDate },
      end:   { date: endDate   },
    }
  }

  // Timed
  return {
    summary: ev.title || '(No title)',
    description: ev.notes || '',
    location: ev.location || undefined,
    start: { dateTime: new Date(sNum).toISOString(), ...(tz ? { timeZone: tz } : {}) },
    end:   { dateTime: new Date(eNum).toISOString(), ...(tz ? { timeZone: tz } : {}) },
  }
}

export function createGoogleAdapter(opts: { accountKey?: string; calendars?: string[] }): ProviderAdapter {
  const calendars = opts.calendars && opts.calendars.length ? opts.calendars : ['primary']

  return {
    provider: 'google',

    /** PULL: windowed incremental w/ syncToken reuse (instances only) */
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
            // IMPORTANT: no orderBy when using syncToken
            params.syncToken = sinceToken
          } else {
            // Only in window mode; ordering allowed here
            params.orderBy = 'startTime'
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
            // Skip series masters; singleEvents=true returns instances we want
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

    /** PUSH: create/update/delete */
    async push(intents: PushIntent[]) {
      const results: PushResult[] = []
      if (!intents || intents.length === 0) return results

      for (const it of intents) {
        const ev = it.local as LocalEvent
        if (!ev || !ev.start || !ev.end) {
          results.push({ ok: false, action: it.action, localId: ev?.id || '', error: 'Missing start/end' })
          continue
        }

        const remoteArr = Array.isArray((ev as any)._remote) ? (ev as any)._remote as Array<any> : []
        const boundGoogle = remoteArr.find(r => r?.provider === 'google')
        const calendarId = (boundGoogle?.calendarId) || (calendars[0] || 'primary')

        try {
          if (it.action === 'delete') {
            if (!boundGoogle?.externalId) {
              // nothing to delete in Google; succeed to clear journal
              results.push({ ok: true, action: 'delete', localId: ev.id })
              continue
            }
            await gfetchBody('DELETE',
              `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(boundGoogle.externalId)}`
            )
            results.push({ ok: true, action: 'delete', localId: ev.id })
            continue
          }

          // Build body; throws RangeError on invalid dates
          const body = toGoogleBody(ev, (ev as any).timezone)

          if (!boundGoogle) {
            // CREATE for unbound local event
            const created = await gfetchBody<GoogleEvent>(
              'POST',
              `/calendars/${encodeURIComponent(calendarId)}/events`,
              body
            )
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
            // UPDATE existing google-bound event (optimistic with etag)
            const updated = await gfetchBody<GoogleEvent>(
              'PATCH',
              `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(boundGoogle.externalId)}`,
              body,
              boundGoogle.etag
            )
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
