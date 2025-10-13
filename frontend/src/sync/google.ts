// frontend/src/sync/google.ts
// Incremental Google adapter with:
// - Robust pull (instances only, correct all-day mapping, syncToken/orderBy rules)
// - Write support: create, update (If-Match with 412 retry), delete
// - All-day exclusive-end mapping, RRULE passthrough, basic attendees

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult } from './types'
import { getAccessToken } from '../google/oauth'

type GoogleEvent = {
  id?: string
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
    id: g.id!, // instance id (unique per occurrence in singleEvents mode)
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
      externalId: g.id!,
      etag: g.etag,
    }],
  }
}

async function gfetch(path: string, params: Record<string, string>): Promise<ListResp> {
  const token = await getAccessToken()
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

/** Low-level write with optional If-Match (ETag) */
async function gwrite(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: any,
  etag?: string
): Promise<Response> {
  const token = await getAccessToken()
  const url = `https://www.googleapis.com/calendar/v3${path}`
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (body) headers['Content-Type'] = 'application/json'
  if (etag) headers['If-Match'] = etag
  return fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
}

/** Map local event to Google wire body */
function localToGoogleBody(local: any, zone?: string): GoogleEvent {
  const isAllDay = !!local.allDay

  if (isAllDay) {
    // Use UTC calendar dates; Google wants exclusive end date
    const start = new Date(local.start)
    const yyyy = start.toISOString().slice(0, 10)
    const endDate = new Date(start)
    endDate.setUTCDate(endDate.getUTCDate() + 1)
    const yyyyEnd = endDate.toISOString().slice(0, 10)

    return {
      summary: local.title || '',
      description: local.notes || undefined,
      location: local.location || undefined,
      start: { date: yyyy },
      end: { date: yyyyEnd },
      recurrence: local.rrule ? [`RRULE:${local.rrule}`] : undefined,
      attendees: Array.isArray(local.attendees)
        ? local.attendees.map((x: string) => ({ email: x }))
        : undefined,
    }
  } else {
    // Timed event: keep explicit zone for clarity
    const startISO = local.start
    const endISO = local.end
    return {
      summary: local.title || '',
      description: local.notes || undefined,
      location: local.location || undefined,
      start: { dateTime: startISO, timeZone: zone },
      end:   { dateTime: endISO,   timeZone: zone },
      recurrence: local.rrule ? [`RRULE:${local.rrule}`] : undefined,
      attendees: Array.isArray(local.attendees)
        ? local.attendees.map((x: string) => ({ email: x }))
        : undefined,
    }
  }
}

export function createGoogleAdapter(opts: { accountKey?: string; calendars?: string[] }): ProviderAdapter {
  const calendars = opts.calendars && opts.calendars.length ? opts.calendars : ['primary']

  return {
    provider: 'google',

    /** ---------- PULL (incremental) ---------- */
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
            // With syncToken: MUST NOT set timeMin/timeMax/orderBy
            params.syncToken = sinceToken
          } else {
            // Windowed initial/backfill pull
            params.orderBy = 'startTime'
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
              // Token invalid/ordering conflict → restart windowed
              useSyncToken = false
              pageToken = undefined
              continue
            }
            if (code === '429') { await new Promise(r => setTimeout(r, 1000)); continue }
            throw e
          }

          const items = Array.isArray(data.items) ? data.items : []
          for (const g of items) {
            // Skip series masters (only want expanded instances)
            const isMaster = Array.isArray(g.recurrence) && g.recurrence.length > 0 && !g.originalStartTime
            if (isMaster) continue

            if (g.status === 'cancelled') {
              events.push({ operation: 'delete', calendarId: calId, externalId: g.id! })
              continue
            }

            const payload = mapGoogleToLocal(g)
            if (!payload) continue
            if (payload._remote && payload._remote[0]) payload._remote[0].calendarId = calId

            events.push({
              operation: 'upsert',
              calendarId: calId,
              externalId: g.id!,
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

    /** ---------- PUSH (create / update / delete) ---------- */
    async push(intents: PushIntent[]) {
      const results: PushResult[] = []
      const defaultCal = calendars[0] || 'primary'
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

      for (const intent of intents) {
        try {
          if (intent.action === 'delete') {
            const bound = intent.target
            if (!bound?.externalId) {
              // Nothing to delete remotely (was never pushed)
              results.push({ ok: true, action: 'delete', localId: intent.local.id })
              continue
            }
            const calId = bound.calendarId || defaultCal
            const res = await gwrite('DELETE', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(bound.externalId)}`, undefined, bound.etag)
            if (res.status === 412) {
              // ETag mismatch → retry without If-Match
              await gwrite('DELETE', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(bound.externalId)}`)
            } else if (!res.ok && res.status !== 404) {
              throw new Error(String(res.status))
            }
            results.push({ ok: true, action: 'delete', localId: intent.local.id })
            continue
          }

          if (intent.action === 'create') {
            const calId = (intent.preferredTarget && intent.preferredTarget.calendarId) || defaultCal
            const body = localToGoogleBody(intent.local, zone)
            const res = await gwrite('POST', `/calendars/${encodeURIComponent(calId)}/events`, body)
            if (!res.ok) throw new Error(String(res.status))
            const created = (await res.json()) as GoogleEvent
            results.push({
              ok: true,
              action: 'create',
              localId: intent.local.id,
              bound: {
                provider: 'google',
                calendarId: calId,
                externalId: created.id!,
                etag: created.etag,
              },
            })
            continue
          }

          if (intent.action === 'update') {
            const bound = intent.target
            // If there’s no binding, treat as create-once
            if (!bound?.externalId) {
              const calId = (intent.preferredTarget && intent.preferredTarget.calendarId) || defaultCal
              const body = localToGoogleBody(intent.local, zone)
              const res = await gwrite('POST', `/calendars/${encodeURIComponent(calId)}/events`, body)
              if (!res.ok) throw new Error(String(res.status))
              const created = (await res.json()) as GoogleEvent
              results.push({
                ok: true,
                action: 'create',
                localId: intent.local.id,
                bound: {
                  provider: 'google',
                  calendarId: calId,
                  externalId: created.id!,
                  etag: created.etag,
                },
              })
              continue
            }

            const calId = bound.calendarId || defaultCal
            const body = localToGoogleBody(intent.local, zone)
            let res = await gwrite('PATCH', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(bound.externalId)}`, body, bound.etag)
            if (res.status === 412) {
              // ETag mismatch → retry without If-Match
              res = await gwrite('PATCH', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(bound.externalId)}`, body)
            }
            if (!res.ok) throw new Error(String(res.status))
            const updated = (await res.json()) as GoogleEvent
            results.push({
              ok: true,
              action: 'update',
              localId: intent.local.id,
              bound: {
                provider: 'google',
                calendarId: calId,
                externalId: updated.id!,
                etag: updated.etag,
              },
            })
            continue
          }

          // Unknown action → don’t block the journal
          results.push({ ok: true, action: intent.action, localId: intent.local.id })
        } catch (err: any) {
          results.push({
            ok: false,
            action: intent.action,
            localId: intent.local.id,
            error: err?.message || String(err),
          })
        }
      }

      return results
    },
  }
}
