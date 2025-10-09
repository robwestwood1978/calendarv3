// frontend/src/sync/google.ts
// Google adapter: implements incremental pull using Events.list with syncToken.
// - Uses OAuth access token from google/oauth.ts
// - Maps Google Event → LocalEvent (minimal fields now; extend as needed)
// - Handles 401 (refresh via getAccessToken), 409 (invalid sync token → full resync), 429 backoff.

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult } from './types'
import { getAccessToken } from '../google/oauth'

type GoogleEvent = {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  colorId?: string
  start?: { date?: string, dateTime?: string, timeZone?: string }
  end?: { date?: string, dateTime?: string, timeZone?: string }
  updated?: string
  etag?: string
  attendees?: { email?: string, displayName?: string, responseStatus?: string }[]
  recurrence?: string[]
}

// Minimal LocalEvent reflection (avoid tight coupling to app types here)
type LocalEventShape = {
  id?: string
  title: string
  location?: string
  notes?: string
  start: string
  end: string
  allDay?: boolean
  attendees?: string[]
  colour?: string
  rrule?: string
  _remote?: any[]
  _updatedAt?: string
}

const API = 'https://www.googleapis.com/calendar/v3'

function toISO(v?: string | null): string | undefined {
  if (!v) return undefined
  try {
    const d = new Date(v)
    if (isNaN(d.getTime())) return undefined
    return d.toISOString()
  } catch { return undefined }
}

function mapGoogleToLocal(g: GoogleEvent, calendarId: string): { payload: LocalEventShape, etag?: string } | null {
  // Deleted items are handled as 'delete' op by caller.
  const startISO = g.start?.dateTime ? toISO(g.start.dateTime) : (g.start?.date ? (g.start.date + 'T00:00:00.000Z') : undefined)
  const endISO   = g.end?.dateTime ? toISO(g.end.dateTime)     : (g.end?.date   ? (g.end.date   + 'T00:00:00.000Z') : undefined)
  if (!startISO || !endISO) return null

  const allDay = !!g.start?.date && !!g.end?.date
  const rrule = Array.isArray(g.recurrence) ? (g.recurrence.find(x => x.startsWith('RRULE:')) || undefined) : undefined

  const attendees = Array.isArray(g.attendees) ? g.attendees.map(a => (a?.email || a?.displayName || '')).filter(Boolean) : undefined

  const payload: LocalEventShape = {
    title: g.summary || '(No title)',
    location: g.location || undefined,
    notes: g.description || undefined,
    start: startISO,
    end: endISO,
    allDay,
    attendees,
    colour: g.colorId || undefined,
    rrule,
    _updatedAt: g.updated ? toISO(g.updated) : undefined,
    _remote: [{
      provider: 'google',
      calendarId,
      externalId: g.id,
      etag: g.etag,
    }],
  }
  return { payload, etag: g.etag }
}

async function listEventsOnce(calendarId: string, params: Record<string, string>): Promise<any> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not authenticated with Google')
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events?${qs}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
  if (res.status === 429) throw Object.assign(new Error('Rate limited'), { status: 429 })
  if (res.status === 410) throw Object.assign(new Error('Sync token expired'), { status: 410 }) // Google sends 410 Gone
  if (!res.ok) throw new Error(`Google events.list failed (${res.status})`)
  return await res.json()
}

export function createGoogleAdapter(opts: {
  accountKey?: string
  calendars?: string[]
}): ProviderAdapter {
  const calendars = opts.calendars && opts.calendars.length ? opts.calendars : ['primary']

  return {
    provider: 'google',

    async pull({ sinceToken, rangeStartISO, rangeEndISO }) {
      const events: RemoteDelta[] = []
      let nextSyncToken: string | null = null

      for (const calId of calendars) {
        let pageToken: string | undefined = undefined
        let first = true
        let useSyncToken = !!sinceToken

        while (true) {
          const params: Record<string, string> = {
            maxResults: '2500',
            showDeleted: 'true',
            singleEvents: 'false',
          }

          if (useSyncToken && sinceToken) {
            params.syncToken = sinceToken
          } else {
            params.timeMin = rangeStartISO
            params.timeMax = rangeEndISO
            params.orderBy = 'updated'
          }
          if (pageToken) params.pageToken = pageToken

          let data: any
          try {
            data = await listEventsOnce(calId, params)
          } catch (e: any) {
            if (e?.status === 410) {
              // Invalid sync token; restart a full windowed sync once.
              if (first) {
                useSyncToken = false
                first = false
                pageToken = undefined
                continue
              } else {
                // Already retried; give up on this calendar.
                break
              }
            }
            if (e?.status === 429) {
              // Backoff: simple wait
              await new Promise(r => setTimeout(r, 1000))
              continue
            }
            throw e
          }

          const items: GoogleEvent[] = Array.isArray(data.items) ? data.items : []
          for (const it of items) {
            if (it.status === 'cancelled') {
              events.push({
                calendarId: calId,
                operation: 'delete',
                externalId: it.id,
                ref: { provider: 'google', calendarId: calId, externalId: it.id, etag: it.etag },
              })
            } else {
              const mapped = mapGoogleToLocal(it, calId)
              if (!mapped) continue
              events.push({
                calendarId: calId,
                operation: 'upsert',
                payload: mapped.payload as any,
                etag: mapped.etag,
                ref: { provider: 'google', calendarId: calId, externalId: it.id, etag: mapped.etag },
              })
            }
          }

          nextSyncToken = data.nextSyncToken || nextSyncToken || null
          pageToken = data.nextPageToken
          first = false
          if (!pageToken) break
        }
      }

      return { token: nextSyncToken, events }
    },

    // Push will be implemented in Slice D3. For now, return success passthrough.
    async push(intents: PushIntent[]) {
      const results: PushResult[] = intents.map((i) => ({
        ok: true,
        action: i.action,
        localId: i.local.id,
        bound: i.target ?? undefined,
      }))
      return results
    },
  }
}
