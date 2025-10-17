// Incremental Google adapter (pull instances; push create/update/delete safely)

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult } from './types'
import { getAccessToken } from '../google/oauth'
import { readSyncConfig } from './core'

type GoogleEvent = {
  id?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  colorId?: string
  recurringEventId?: string
  recurrence?: string[]
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string }
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { email?: string; displayName?: string }[]
  etag?: string
  updated?: string
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

function mapGoogleToLocal(g: GoogleEvent, calId: string) {
  const isAllDay = !!g.start?.date && !!g.end?.date

  const startISO = isAllDay
    ? toISO(`${g.start!.date}T00:00:00Z`)
    : toISO(g.start?.dateTime)

  // Google all-day end is exclusive → subtract 1ms
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
    id: g.id!, // instance id (unique per occurrence)
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
      calendarId: calId,
      externalId: g.id!,
      etag: g.etag,
    }],
  }
}

async function gfetch(path: string, params: Record<string, string>, init?: RequestInit): Promise<any> {
  const token = await getAccessToken()
  if (!token) throw new Error('no_token')

  let url: URL
  if (path.startsWith('http')) {
    url = new URL(path)
  } else {
    url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  }
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

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
  if (res.status === 429) throw new Error('429')
  if (res.status === 410) throw new Error('410')
  if (res.status === 400) throw new Error('400')
  if (!res.ok) throw new Error(`${res.status}`)

  // Return JSON or nothing (204)
  const text = await res.text()
  try { return text ? JSON.parse(text) : null } catch { return null }
}

function pickCalendarId(): string {
  const cfg = readSyncConfig()
  const cals = cfg?.providers?.google?.calendars
  return (Array.isArray(cals) && cals[0]) || 'primary'
}

function localToGoogleBody(local: any): GoogleEvent {
  const isAllDay = !!local.allDay ||
                   (!!local.start && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(String(local.start)) &&
                    !!local.end   && /23:59:59\.999Z$/.test(String(local.end)))

  const ensureISO = (v?: string) => (v ? new Date(v).toISOString() : undefined)

  if (!local?.start || !local?.end) throw new Error('missing start/end')

  if (isAllDay) {
    // convert inclusive end → exclusive end date
    const startDate = new Date(ensureISO(local.start)!)
    const endDateInc = new Date(ensureISO(local.end)!)
    const endDateExc = new Date(endDateInc.getTime() + 1) // 23:59:59.999 + 1ms → next-day 00:00
    const sd = startDate.toISOString().slice(0, 10)
    const ed = endDateExc.toISOString().slice(0, 10)

    return {
      summary: local.title || '',
      description: local.notes || undefined,
      location: local.location || undefined,
      start: { date: sd },
      end: { date: ed },
      recurrence: local.rrule ? [`RRULE:${local.rrule}`] : undefined,
    }
  }

  return {
    summary: local.title || '',
    description: local.notes || undefined,
    location: local.location || undefined,
    start: { dateTime: ensureISO(local.start) },
    end:   { dateTime: ensureISO(local.end) },
    recurrence: local.rrule ? [`RRULE:${local.rrule}`] : undefined,
  }
}

export function createGoogleAdapter(): ProviderAdapter {
  return {
    provider: 'google',

    async pull({ sinceToken, rangeStartISO, rangeEndISO }) {
      const events: RemoteDelta[] = []
      let nextSyncToken: string | null = null

      const calId = pickCalendarId()
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

          if (g.status === 'cancelled' && g.id) {
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
            externalId: g.id!,
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

      return { token: nextSyncToken || sinceToken || null, events }
    },

    async push(intents: PushIntent[]) {
      const calId = pickCalendarId()
      const results: PushResult[] = []

      for (const intent of intents) {
        const local = intent.local as any
        try {
          // Decide operation based on existing google binding
          const binding = Array.isArray(local._remote)
            ? local._remote.find((b: any) => b?.provider === 'google')
            : null

          if (intent.action === 'delete') {
            if (binding?.externalId) {
              await gfetch(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(binding.externalId)}`, {}, { method: 'DELETE' })
            }
            results.push({ ok: true, action: intent.action, localId: local.id })
            continue
          }

          const body = localToGoogleBody(local)

          if (binding?.externalId) {
            // update
            const updated = await gfetch(
              `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(binding.externalId)}`,
              {},
              { method: 'PATCH', body: JSON.stringify(body) }
            )
            results.push({
              ok: true,
              action: intent.action,
              localId: local.id,
              bound: {
                provider: 'google',
                calendarId: calId,
                externalId: updated?.id || binding.externalId,
                etag: updated?.etag,
              }
            })
          } else {
            // create
            const created = await gfetch(
              `/calendars/${encodeURIComponent(calId)}/events`,
              {},
              { method: 'POST', body: JSON.stringify(body) }
            )
            results.push({
              ok: true,
              action: intent.action,
              localId: local.id,
              bound: {
                provider: 'google',
                calendarId: calId,
                externalId: created?.id,
                etag: created?.etag,
              }
            })
          }
        } catch (err) {
          console.warn('[google.push] failed', err)
          results.push({ ok: false, action: intent.action, localId: local?.id })
        }
      }

      return results
    },
  }
}
