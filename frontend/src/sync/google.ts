// frontend/src/sync/google.ts
// Google Calendar adapter: incremental pull + real push (create/update/delete)
// - Handles 400/409/410 gracefully when using syncToken
// - Maps all-day properly (Google end date is exclusive)
// - Writes/reads extra metadata via extendedProperties.private
// - Sends attendees to Google

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult } from './types'
import { getAccessToken } from '../google/oauth'

type GoogleAttendee = { email?: string; displayName?: string; responseStatus?: string }
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
  start?: { dateTime?: string; date?: string; timeZone?: string; date?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string; date?: string }
  attendees?: GoogleAttendee[]
  extendedProperties?: { private?: Record<string,string> }
  etag?: string
}

type ListResp = {
  items?: GoogleEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

function toISO(z?: string) {
  if (!z) return undefined
  const d = new Date(z)
  return isNaN(+d) ? undefined : d.toISOString()
}

function tryParseJSON<T = any>(s?: string): T | undefined {
  if (!s) return undefined
  try { return JSON.parse(s) as T } catch { return undefined }
}

function mapGoogleToLocal(g: GoogleEvent) {
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
    ? g.recurrence.find(x => x?.toUpperCase?.().startsWith('RRULE:'))
    : undefined

  const attendees = Array.isArray(g.attendees)
    ? g.attendees.map(a => a?.email || a?.displayName || '').filter(Boolean)
    : undefined

  const priv = g.extendedProperties?.private || {}
  const tags = tryParseJSON<string[]>(priv['fc.tags'])
  const bring = tryParseJSON<string[]>(priv['fc.bring'])

  return {
    id: g.id, // instance id (unique per occurrence when singleEvents=true)
    title: g.summary || '(No title)',
    start: startISO,
    end: endISO,
    allDay: isAllDay || undefined,
    location: g.location || undefined,
    notes: g.description || undefined,
    attendees,
    tags,
    checklist: bring,
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

async function gfetch(
  path: string,
  params?: Record<string, string>,
  init?: RequestInit
) {
  const token = await getAccessToken()
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (res.status === 401) throw new Error('401')
  if (res.status === 409) throw new Error('409') // syncToken old
  if (res.status === 410) throw new Error('410') // syncToken expired
  if (res.status === 429) throw new Error('429') // rate limits
  if (res.status === 400) {
    // Bubble 400 (e.g. syncTokenWithNonDefaultOrdering) as 400
    throw new Error('400')
  }
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

// Build a Google resource from our local event
function toGoogleResource(local: any): any {
  const isAllDay = !!local.allDay
  const body: any = {
    summary: local.title || '',
    description: local.notes || undefined,
    location: local.location || undefined,
    extendedProperties: {
      private: {
        'fc.tags': JSON.stringify(local.tags || []),
        'fc.bring': JSON.stringify(local.checklist || []),
      }
    }
  }

  if (Array.isArray(local.attendees) && local.attendees.length) {
    body.attendees = local.attendees
      .map((s: string) => (s || '').trim())
      .filter(Boolean)
      .map((s: string) => {
        const looksEmail = /@/.test(s)
        return looksEmail ? { email: s } : { displayName: s }
      })
  }

  if (isAllDay) {
    // local end is inclusive → convert to exclusive date
    const startDate = new Date(local.start)
    const endInclusive = new Date(local.end)
    const endExclusive = new Date(endInclusive.getTime() + 1) // +1ms
    const endDate = new Date(Date.UTC(
      endExclusive.getUTCFullYear(),
      endExclusive.getUTCMonth(),
      endExclusive.getUTCDate(), 0, 0, 0, 0
    ))
    body.start = { date: startDate.toISOString().slice(0, 10) }
    body.end   = { date: endDate.toISOString().slice(0, 10) }
  } else {
    body.start = { dateTime: new Date(local.start).toISOString() }
    body.end   = { dateTime: new Date(local.end).toISOString() }
  }

  if (local.rrule) body.recurrence = [`RRULE:${local.rrule}`]

  return body
}

// ---------- adapter ----------

export function createGoogleAdapter(opts: { accountKey?: string; calendars?: string[] }): ProviderAdapter {
  const calendars = (opts.calendars && opts.calendars.length) ? opts.calendars : ['primary']

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
            singleEvents: 'true', // expand instances
          }

          if (useSyncToken && sinceToken) {
            // IMPORTANT: no orderBy with syncToken
            params.syncToken = sinceToken
          } else {
            params.orderBy = 'startTime'
            // RFC3339 sanity
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
            data = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`, params)
          } catch (e: any) {
            const code = e?.message
            if (code === '409' || code === '410' || code === '400') {
              // reset to window mode
              useSyncToken = false
              pageToken = undefined
              continue
            }
            if (code === '429') {
              await new Promise(r => setTimeout(r, 1000))
              continue
            }
            throw e
          }

          const items = Array.isArray(data.items) ? data.items : []
          for (const g of items) {
            // Skip series masters (we want instances only)
            const isMaster = Array.isArray(g.recurrence) && g.recurrence.length > 0 && !g.originalStartTime
            if (isMaster) continue

            if (g.status === 'cancelled') {
              events.push({ operation: 'delete', calendarId: calId, externalId: g.id })
              continue
            }

            const payload = mapGoogleToLocal(g)
            if (!payload) continue
            if (payload._remote?.[0]) payload._remote[0].calendarId = calId

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

    // -------- PUSH (create / update / delete) --------
    async push(intents: PushIntent[]) {
      const results: PushResult[] = []
      const defaultCal = calendars[0] || 'primary'

      for (const i of intents) {
        try {
          if (i.action === 'delete') {
            const calId = i.target?.calendarId || defaultCal
            const externalId = i.target?.externalId
            if (externalId) {
              await gfetch(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(externalId)}`,
                undefined, { method: 'DELETE' })
            }
            results.push({ ok: true, action: 'delete', localId: i.local.id })
            continue
          }

          if (i.action === 'create') {
            const calId = (i.preferredTarget as any)?.calendarId || defaultCal
            const body = toGoogleResource(i.local)
            const created = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`,
              undefined, { method: 'POST', body: JSON.stringify(body) }) as GoogleEvent
            results.push({
              ok: true, action: 'create', localId: i.local.id,
              bound: { provider: 'google', calendarId: calId, externalId: created.id, etag: created.etag }
            })
            continue
          }

          if (i.action === 'update') {
            const calId = i.target?.calendarId || defaultCal
            const externalId = i.target?.externalId
            const body = toGoogleResource(i.local)
            const updated = await gfetch(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(externalId!)}`,
              undefined, { method: 'PATCH', body: JSON.stringify(body) }) as GoogleEvent
            results.push({
              ok: true, action: 'update', localId: i.local.id,
              bound: { provider: 'google', calendarId: calId, externalId: updated.id, etag: updated.etag }
            })
            continue
          }

          // Fallback
          results.push({ ok: true, action: i.action, localId: i.local.id })
        } catch (e: any) {
          results.push({ ok: false, action: i.action, localId: i.local.id, error: e?.message || String(e) })
        }
      }

      return results
    },
  }
}
