// frontend/src/sync/google.ts
// Incremental Google adapter (instances only; proper all-day mapping)

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

function toISO(z: string | undefined) {
  if (!z) return undefined
  // Rely on Date/ISO parsing; Luxon not required here
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
    id: g.id,                              // instance id (unique per occurrence)
    title: g.summary || '(No title)',
    start: startISO,
    end: endISO,
    allDay: isAllDay || undefined,
    location: g.location || undefined,
    notes: g.description || undefined,
    attendees,
    rrule: rrule ? rrule.replace(/^RRULE:/i, '') : undefined,
    colour: undefined, // map colorId→hex if you decide to later
    _remote: [{
      provider: 'google',
      calendarId: '', // filled by caller
      externalId: g.id,
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
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
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
            singleEvents: 'true',   // <— EXPAND INSTANCES
            orderBy: 'startTime',
          }
          if (useSyncToken && sinceToken) {
            params.syncToken = sinceToken
          } else {
            params.timeMin = rangeStartISO
            params.timeMax = rangeEndISO
          }
          if (pageToken) params.pageToken = pageToken

          let data: ListResp
          try {
            data = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`, params)
          } catch (e: any) {
            // Token invalid → resync from time window
            if (e.message === '409') {
              useSyncToken = false
              pageToken = undefined
              continue
            }
            // 429: soft backoff (client side)
            if (e.message === '429') {
              await new Promise(r => setTimeout(r, 1000))
              continue
            }
            // For 401, getAccessToken already tried refresh; bubble up
            throw e
          }

          const items = Array.isArray(data.items) ? data.items : []
          for (const g of items) {
            // Defensive master skip: masters have recurrence but no originalStartTime
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
            // attach calendarId to remote binding
            if (payload._remote && payload._remote[0]) {
              payload._remote[0].calendarId = calId
            }

            events.push({
              operation: 'upsert',
              calendarId: calId,
              externalId: g.id,
              etag: g.etag,
              payload,
            })
          }

          if (data.nextPageToken) {
            pageToken = data.nextPageToken
            continue
          }
          nextSyncToken = data.nextSyncToken || nextSyncToken
          break
        }
      }

      return { token: nextSyncToken || sinceToken || null, events }
    },

    // Push is Slice D3 (no-op passthrough for now)
    async push(intents: PushIntent[]) {
      const results: PushResult[] = intents.map(i => ({
        ok: true,
        action: i.action,
        localId: i.local.id,
        bound: i.target ?? undefined,
      }))
      return results
    },
  }
}
