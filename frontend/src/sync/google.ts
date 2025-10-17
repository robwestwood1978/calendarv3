// Incremental Google adapter (pull instances, push create/update/delete)
// Works with your existing oauth.ts (uses getAccessToken). Safe mapping for all-day.

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult } from './types'
import { getAccessToken } from '../google/oauth'
import { readSyncConfig } from './core'

type GoogleEvent = {
  id: string
  status?: 'confirmed' | 'cancelled' | 'tentative'
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

function toISO(z?: string | null) {
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
    _remote: [{
      provider: 'google',
      calendarId: '', // filled by caller
      externalId: g.id,
      etag: g.etag,
    }],
  }
}

async function gfetch(path: string, params?: Record<string, string>, init?: RequestInit) {
  const token = await getAccessToken()
  if (!token) throw new Error('NO_TOKEN')
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 401) throw new Error('401')
  if (res.status === 409) throw new Error('409')
  if (res.status === 429) throw new Error('429')
  if (res.status === 410) throw new Error('410')
  if (res.status === 400) throw new Error('400')
  if (!res.ok) throw new Error(String(res.status))
  return res
}

export function createGoogleAdapter(opts?: { accountKey?: string; calendars?: string[] }): ProviderAdapter {
  // calendar selection comes from sync config but allow override via opts
  function activeCalendar(): string {
    const cfg = readSyncConfig()
    const pick = opts?.calendars?.[0]
      || cfg?.providers?.google?.calendars?.[0]
      || 'primary'
    return pick || 'primary'
  }

  return {
    provider: 'google',

    async pull({ sinceToken, rangeStartISO, rangeEndISO }) {
      const calId = activeCalendar()
      const events: RemoteDelta[] = []
      let nextSyncToken: string | null = sinceToken || null

      let pageToken: string | undefined
      let useSyncToken = !!sinceToken

      while (true) {
        const params: Record<string, string> = {
          maxResults: '2500',
          showDeleted: 'true',
          singleEvents: 'true',
        }

        if (useSyncToken && nextSyncToken) {
          params.syncToken = nextSyncToken
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
          const res = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`, params)
          data = await res.json()
        } catch (e: any) {
          const code = e?.message || ''
          if (code === '409' || code === '410' || code === '400') {
            // invalid sync token → fall back to window pull
            useSyncToken = false
            pageToken = undefined
            nextSyncToken = null
            continue
          }
          if (code === '429') { await new Promise(r => setTimeout(r, 800)); continue }
          throw e
        }

        const items = Array.isArray(data.items) ? data.items : []
        for (const g of items) {
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

      return { token: nextSyncToken || sinceToken || null, events }
    },

    // Minimal write-through. We only touch the currently-selected calendar.
    async push(intents: PushIntent[]) {
      const calId = activeCalendar()
      const results: PushResult[] = []

      const mkBody = (ev: any) => {
        const isAllDay = !!ev.allDay || (ev.start && ev.end && ev.start.endsWith('T00:00:00.000Z') && ev.end.endsWith('T23:59:59.999Z'))
        if (isAllDay) {
          // Google all-day end is exclusive (date)
          const d0 = new Date(ev.start)
          const d1 = new Date(ev.end)
          const nextDay = new Date(d1.getTime() + 1) // because our end is inclusive
          const sDate = d0.toISOString().slice(0, 10)
          const eDate = nextDay.toISOString().slice(0, 10)
          return {
            summary: ev.title || '',
            description: ev.notes || undefined,
            location: ev.location || undefined,
            start: { date: sDate },
            end: { date: eDate },
          }
        } else {
          return {
            summary: ev.title || '',
            description: ev.notes || undefined,
            location: ev.location || undefined,
            start: { dateTime: new Date(ev.start).toISOString() },
            end: { dateTime: new Date(ev.end).toISOString() },
          }
        }
      }

      for (const i of intents) {
        try {
          const bound = i.target || (Array.isArray(i.local?._remote) ? i.local._remote.find((r: any)=>r.provider==='google') : null)
          if (i.action === 'create') {
            const body = mkBody(i.local)
            const res = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`, undefined, {
              method: 'POST',
              body: JSON.stringify(body),
            })
            const g: GoogleEvent = await res.json()
            results.push({
              ok: true,
              action: i.action,
              localId: i.local.id,
              bound: { provider: 'google', calendarId: calId, externalId: g.id, etag: g.etag },
            })
          } else if (i.action === 'update') {
            if (!bound?.externalId) {
              // no remote binding yet → create instead
              const body = mkBody(i.local)
              const res = await gfetch(`/calendars/${encodeURIComponent(calId)}/events`, undefined, {
                method: 'POST',
                body: JSON.stringify(body),
              })
              const g: GoogleEvent = await res.json()
              results.push({
                ok: true,
                action: 'create',
                localId: i.local.id,
                bound: { provider: 'google', calendarId: calId, externalId: g.id, etag: g.etag },
              })
              continue
            }
            const body = mkBody(i.local)
            const res = await gfetch(
              `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(bound.externalId)}`,
              undefined,
              { method: 'PATCH', body: JSON.stringify(body) }
            )
            const g: GoogleEvent = await res.json()
            results.push({
              ok: true,
              action: i.action,
              localId: i.local.id,
              bound: { provider: 'google', calendarId: calId, externalId: g.id, etag: g.etag },
            })
          } else if (i.action === 'delete') {
            if (bound?.externalId) {
              await gfetch(
                `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(bound.externalId)}`,
                undefined,
                { method: 'DELETE' }
              )
            }
            results.push({ ok: true, action: i.action, localId: i.local.id })
          } else {
            results.push({ ok: true, action: i.action, localId: i.local.id })
          }
        } catch (e) {
          console.warn('[google.push] failed', e)
          results.push({ ok: false, action: i.action, localId: i.local.id, error: String(e) })
        }
      }

      return results
    },
  }
}
