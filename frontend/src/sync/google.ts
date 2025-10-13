// frontend/src/sync/google.ts
// Google Calendar adapter: incremental pull + real push (create/update/delete)

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult } from './types'
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

// ---------- helpers ----------

function toISO(z?: string) {
  if (!z) return undefined
  const d = new Date(z)
  return isNaN(+d) ? undefined : d.toISOString()
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
    ? g.recurrence.find(x => x.toUpperCase().startsWith('RRULE:'))
    : undefined

  const attendees = Array.isArray(g.attendees)
    ? g.attendees.map(a => a?.email || a?.displayName || '').filter(Boolean)
    : undefined

  return {
    id: g.id,
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
  if (res.status === 409) throw new Error('409')
  if (res.status === 410) throw new Error('410')
  if (res.status === 429) throw new Error('429')
  if (res.status === 400) throw new Error('400')
  if (!res.ok) throw new Error(`${res.status}`)
  return res.status === 204 ? null : res.json()
}

// Build a Google resource from our local event
function toGoogleResource(local: any): any {
  const isAllDay = !!local.allDay
  // NOTE: we send UTC ISO for dateTime; Google will render in user’s zone.
  const body: any = {
    summary: local.title || '',
    description: local.notes || undefined,
    location: local.location || undefined,
  }

  if (isAllDay) {
    // local end is inclusive (23:59:59.999) → convert to exclusive date
    const startDate = new Date(local.start)
    const endInclusive = new Date(local.end)
    const endExclusive = new Date(endInclusive.getTime() + 1) // +1ms
    const endDate = new Date(Date.UTC(
      endExclusive.getUTCFullYear(),
      endExclusive.getUTCMonth(),
      endExclusive.getUTCDate(),
      0, 0, 0, 0
    ))
    body.start = { date: startDate.toISOString().slice(0, 10) }
    body.end   = { date: endDate.toISOString().slice(0, 10) }
  } else {
    body.start = { dateTime: new Date(local.start).toISOString() }
    body.end   = { dateTime: new Date(local.end).toISOString() }
  }

  // Optional: recurrence (RFC5545 string w/o RRULE: prefix in our model)
  if (local.rrule) {
    body.recurrence = [`RRULE:${local.rrule}`]
  }

  return body
}

// ---------- adapter ----------

export function createGoogleAdapter(opts: { accountKey?: string; calendars?: string[] }): ProviderAdapter {
  const calendars = opts.calendars && opts.calendars.length ? opts.calendars : ['primary']

  return {
    provider: 'google',

    // -------- PULL (unchanged except sync-token guards) --------
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
            // IMPORTANT: no orderBy with syncToken
            params.syncToken = sinceToken
          } else {
            params.orderBy = 'startTime'
            // normalise just to be safe
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
              // invalid sync token → restart with time window
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

          const items = Array.isArray(data?.items) ? data.items! : []
          for (const g of items) {
            // Skip series masters (we want expanded instances only)
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

          if (data?.nextPageToken) { pageToken = data.nextPageToken; continue }
          nextSyncToken = data?.nextSyncToken || nextSyncToken
          break
        }
      }

      return { token: nextSyncToken || sinceToken || null, events }
    },

    // -------- PUSH (real) --------
    async push(intents: PushIntent[]) {
      const results: PushResult[] = []

      // choose the first configured calendar if target not specified
      const defaultCal = calendars[0] || 'primary'

      for (const i of intents) {
        try {
          if (i.action === 'delete') {
            const calId = i.target?.calendarId || defaultCal
            const externalId = i.target?.externalId
            if (externalId) {
              await gfetch(
                `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(externalId)}`,
                undefined,
                { method: 'DELETE' }
              )
            }
            results.push({ ok: true, action: 'delete', localId: i.local.id })
            continue
          }

          if (i.action === 'create') {
            const calId = (i.preferredTarget as any)?.calendarId || defaultCal
            const body = toGoogleResource(i.local)
            const created = await gfetch(
              `/calendars/${encodeURIComponent(calId)}/events`,
              undefined,
              { method: 'POST', body: JSON.stringify(body) }
            ) as GoogleEvent
            results.push({
              ok: true,
              action: 'create',
              localId: i.local.id,
              bound: {
                provider: 'google',
                calendarId: calId,
                externalId: created.id,
                etag: created.etag,
              }
            })
            continue
          }

          if (i.action === 'update') {
            const calId = i.target?.calendarId || defaultCal
            const externalId = i.target?.externalId
            const body = toGoogleResource(i.local)
            const updated = await gfetch(
              `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(externalId || '')}`,
              undefined,
              { method: externalId ? 'PATCH' : 'POST', body: JSON.stringify(body) }
            ) as GoogleEvent
            results.push({
              ok: true,
              action: 'update',
              localId: i.local.id,
              bound: {
                provider: 'google',
                calendarId: calId,
                externalId: updated.id,
                etag: updated.etag,
              }
            })
            continue
          }

          // Fallback: treat unknown as no-op success
          results.push({ ok: true, action: i.action, localId: i.local.id })
        } catch (e: any) {
          results.push({
            ok: false,
            action: i.action,
            localId: i.local.id,
            error: e?.message || String(e),
          })
        }
      }

      return results
    },
  }
}
