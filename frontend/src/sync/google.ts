// frontend/src/sync/google.ts
// Google Calendar adapter (Safe Mode Push)
// - Pull: unchanged (instances-only, robust handling of 400/409/410).
// - Push SAFE MODE: send only summary + start/end (+optional plain description/location).
//   No attendees, no recurrence, no extendedProperties.
// - Update falls back to create + rebind on 400/404/410.

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

function mapGoogleToLocal(g: GoogleEvent) {
  const isAllDay = !!g.start?.date && !!g.end?.date
  const startISO = isAllDay ? toISO(`${g.start!.date}T00:00:00Z`) : toISO(g.start?.dateTime)
  const endExclusiveISO = isAllDay ? toISO(`${g.end!.date}T00:00:00Z`) : toISO(g.end?.dateTime)
  if (!startISO || !endExclusiveISO) return null
  const endISO = isAllDay
    ? new Date(new Date(endExclusiveISO).getTime() - 1).toISOString()
    : endExclusiveISO

  const attendees = Array.isArray(g.attendees)
    ? g.attendees.map(a => a?.email || a?.displayName || '').filter(Boolean)
    : undefined

  // We still read notes/location (harmless), but ignore extended props/recurrence in SAFE mode.
  return {
    id: g.id,
    title: g.summary || '(No title)',
    start: startISO,
    end: endISO,
    allDay: isAllDay || undefined,
    location: g.location || undefined,
    notes: g.description || undefined,
    attendees, // kept for local view only
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
  if (res.status === 409) throw new Error('409') // sync token old
  if (res.status === 410) throw new Error('410') // sync token or resource gone
  if (res.status === 429) throw new Error('429') // rate limited
  if (res.status === 400) throw new Error('400') // bad request (often payload)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

/** Ensure valid start/end ordering; fix zero/negative duration */
function ensureValidInterval(startISO: string, endISO: string): { startISO: string; endISO: string } {
  const s = new Date(startISO)
  const e = new Date(endISO)
  if (!isNaN(+s) && !isNaN(+e) && e.getTime() > s.getTime()) return { startISO, endISO }
  const fixedEnd = new Date(s.getTime() + 60_000).toISOString() // +1 minute
  return { startISO, endISO: fixedEnd }
}

/** SAFE MODE: minimal body only (summary + start/end [+ plain description/location]) */
function toGoogleResourceSafe(local: any): any {
  const isAllDay = !!local.allDay

  // Normalise incoming ISO and ensure a valid interval
  const fixed = ensureValidInterval(local.start, local.end)

  const body: any = {
    summary: local.title || '',
  }

  // Optional simple fields that are safe:
  if (local.notes && typeof local.notes === 'string') body.description = local.notes
  if (local.location && typeof local.location === 'string') body.location = local.location

  if (isAllDay) {
    // Convert [start..endInclusive] → Google exclusive end date
    const startDate = new Date(fixed.startISO)
    const endInclusive = new Date(fixed.endISO)
    const endExclusive = new Date(endInclusive.getTime() + 1) // +1ms to hit next day
    const endDate = new Date(Date.UTC(
      endExclusive.getUTCFullYear(),
      endExclusive.getUTCMonth(),
      endExclusive.getUTCDate(), 0, 0, 0, 0
    ))
    body.start = { date: startDate.toISOString().slice(0, 10) }
    body.end   = { date: endDate.toISOString().slice(0, 10) }
  } else {
    body.start = { dateTime: new Date(fixed.startISO).toISOString() }
    body.end   = { dateTime: new Date(fixed.endISO).toISOString() }
  }

  // SAFE MODE intentionally omits:
  // - attendees
  // - recurrence / rrule
  // - extendedProperties (tags/bring)
  // - reminders/visibility/transparency/etc.

  return body
}

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
            singleEvents: 'true',
          }

          if (useSyncToken && sinceToken) {
            // IMPORTANT: no orderBy when using syncToken
            params.syncToken = sinceToken
          } else {
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
              // reset to window mode and retry
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
            // Skip series masters (instances only)
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

    async push(intents: PushIntent[]) {
      const results: PushResult[] = []
      const defaultCal = calendars[0] || 'primary'

      for (const i of intents) {
        try {
          // DELETE
          if (i.action === 'delete') {
            const calId = i.target?.calendarId || defaultCal
            const externalId = i.target?.externalId
            if (externalId) {
              try {
                await gfetch(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(externalId)}`,
                  undefined, { method: 'DELETE' })
              } catch (e: any) {
                if (!['404','410'].includes(e?.message)) throw e // already gone is fine
              }
            }
            results.push({ ok: true, action: 'delete', localId: i.local.id })
            continue
          }

          // CREATE (SAFE)
          if (i.action === 'create') {
            const calId = (i.preferredTarget as any)?.calendarId || defaultCal
            const body = toGoogleResourceSafe(i.local)
            const created = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`,
              undefined, { method: 'POST', body: JSON.stringify(body) }) as GoogleEvent
            results.push({
              ok: true, action: 'create', localId: i.local.id,
              bound: { provider: 'google', calendarId: calId, externalId: created.id, etag: created.etag }
            })
            continue
          }

          // UPDATE (SAFE + fallback to CREATE+rebind)
          if (i.action === 'update') {
            const calId = i.target?.calendarId || defaultCal
            const externalId = i.target?.externalId
            const body = toGoogleResourceSafe(i.local)

            if (!externalId) {
              const created = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`,
                undefined, { method: 'POST', body: JSON.stringify(body) }) as GoogleEvent
              results.push({
                ok: true, action: 'create', localId: i.local.id,
                bound: { provider: 'google', calendarId: calId, externalId: created.id, etag: created.etag }
              })
              continue
            }

            let updated: GoogleEvent | null = null
            try {
              updated = await gfetch(
                `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(externalId)}`,
                undefined, { method: 'PATCH', body: JSON.stringify(body) }
              ) as GoogleEvent
            } catch (e: any) {
              const code = e?.message
              if (['400', '404', '410'].includes(code)) {
                const created = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`,
                  undefined, { method: 'POST', body: JSON.stringify(body) }) as GoogleEvent
                results.push({
                  ok: true, action: 'update', localId: i.local.id,
                  bound: { provider: 'google', calendarId: calId, externalId: created.id, etag: created.etag }
                })
                continue
              }
              throw e
            }

            results.push({
              ok: true, action: 'update', localId: i.local.id,
              bound: { provider: 'google', calendarId: calId, externalId: updated!.id, etag: updated!.etag }
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
