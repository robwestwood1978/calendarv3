// Incremental Google adapter: pull (instances) + robust push (create/update/delete)
// - Windowed pull with syncToken recovery (400/409/410), no `orderBy` when using syncToken
// - All-day events mapped to Google’s exclusive end model
// - Push tolerates missing/invalid dates (skips with ok:false instead of throwing)

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult } from './types'
import { getAccessToken } from '../google/oauth'
import { DateTime } from 'luxon'

/* ---------------- Types from Google ---------------- */

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

/* ---------------- Helpers ---------------- */

function toISO(z?: string) {
  if (!z) return undefined
  const d = new Date(z)
  return isNaN(+d) ? undefined : d.toISOString()
}

function parseDT(s?: string): DateTime | null {
  if (!s) return null
  const dt = DateTime.fromISO(s, { setZone: true })
  return dt.isValid ? dt : null
}

function isAllDayLocal(start?: string, end?: string, explicit?: boolean): boolean {
  if (explicit) return true
  const s = parseDT(start), e = parseDT(end)
  if (!s || !e) return false
  // Treat events that span an exact whole number of days starting at 00:00 as all-day
  const wholeStart = s.hasSame(s.startOf('day'), 'millisecond')
  const millis = e.diff(s, 'milliseconds').milliseconds
  const fullDays = millis > 0 && Math.abs(millis % (24 * 60 * 60 * 1000)) < 2
  return wholeStart && fullDays
}

function mapGoogleToLocal(g: GoogleEvent) {
  // Cancelled handled by caller
  const isAllDay = !!g.start?.date && !!g.end?.date

  const startISO = isAllDay
    ? toISO(`${g.start!.date}T00:00:00Z`)
    : toISO(g.start?.dateTime)

  // Google all-day end is exclusive → subtract 1 ms
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

async function gfetch(path: string, params: Record<string, string>): Promise<ListResp> {
  const token = await getAccessToken()
  if (!token) throw new Error('401')
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new Error('401')
  if (res.status === 409) throw new Error('409')
  if (res.status === 410) throw new Error('410')
  if (res.status === 429) throw new Error('429')
  if (res.status === 400) throw new Error('400')
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

/* ---------------- PULL adapter ---------------- */

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
            singleEvents: 'true', // expand instances
          }

          if (useSyncToken && sinceToken) {
            // IMPORTANT: no orderBy with syncToken
            params.syncToken = sinceToken
          } else {
            // windowed pull
            params.orderBy = 'startTime'
            // Normalize and ensure timeMax > timeMin
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
              // reset sync token → fall back to windowed mode
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
            // Skip series masters; we only want expanded instances
            const isMaster = Array.isArray(g.recurrence) && g.recurrence.length > 0 && !g.originalStartTime
            if (isMaster) continue

            if (g.status === 'cancelled') {
              events.push({ operation: 'delete', calendarId: calId, externalId: g.id })
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

    /* ---------------- PUSH adapter ---------------- */

    async push(intents: PushIntent[]) {
      const results: PushResult[] = []
      const token = await getAccessToken()
      if (!token) {
        // no auth → all fail softly
        for (const i of intents) results.push({ ok: false, action: i.action, localId: i.local.id })
        return results
      }

      // Choose a target calendar (first configured or 'primary')
      const calendarId = (opts.calendars && opts.calendars[0]) || 'primary'

      for (const i of intents) {
        try {
          const res = await handleIntentPush(i, token, calendarId)
          results.push(res)
        } catch (err) {
          console.warn('[google.push] failed', err)
          results.push({ ok: false, action: i.action, localId: i.local.id })
        }
      }

      return results
    },
  }
}

/* ---------------- Push helpers ---------------- */

function localBinding(local: any): { calendarId: string; externalId: string } | null {
  const rems = Array.isArray(local?._remote) ? local._remote : []
  const g = rems.find((r: any) => r?.provider === 'google' && r?.externalId)
  if (!g) return null
  return { calendarId: g.calendarId || 'primary', externalId: g.externalId }
}

/** Map a local event to Google insert/update payload */
function toGoogleBody(local: any): { start: any; end: any; summary: string; description?: string; location?: string } | null {
  const title = (local?.title || '').trim() || 'Untitled'
  const s = parseDT(local?.start)
  const e = parseDT(local?.end)
  if (!s || !e) return null

  const wantsAllDay = isAllDayLocal(local?.start, local?.end, !!local?.allDay)
  if (wantsAllDay) {
    // Local end is inclusive → Google needs exclusive end date
    // Add 1 ms then snap to date boundary next day
    const endExclusive = e.plus({ milliseconds: 1 }).toISODate()
    const startDate = s.startOf('day').toISODate()
    return {
      summary: title,
      location: local?.location || undefined,
      description: local?.notes || undefined,
      start: { date: startDate },
      end: { date: endExclusive },
    }
  }

  // Timed event — include offset; omit explicit timeZone (RFC3339 with offset is fine)
  const startDT = s.toISO()
  const endDT = e.toISO()
  if (!startDT || !endDT) return null

  return {
    summary: title,
    location: local?.location || undefined,
    description: local?.notes || undefined,
    start: { dateTime: startDT },
    end: { dateTime: endDT },
  }
}

async function handleIntentPush(intent: PushIntent, token: string, defaultCalId: string): Promise<PushResult> {
  const local = intent.local || {}
  const method = intent.action

  // Build body (validate dates)
  const body = toGoogleBody(local)
  if (!body) {
    // Bad/missing dates → soft fail, but don’t throw
    return { ok: false, action: method, localId: local.id }
  }

  // Resolve binding (if already synced to Google)
  const binding = localBinding(local)

  try {
    if (method === 'create') {
      const calId = defaultCalId
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`)
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        // (Common: 403 insufficient permissions, 400 invalid date)
        const txt = await res.text().catch(() => '')
        console.warn('[google.push] create failed', res.status, txt)
        return { ok: false, action: method, localId: local.id }
      }
      const ev: GoogleEvent = await res.json()
      return {
        ok: true,
        action: 'create',
        localId: local.id,
        bound: { provider: 'google', calendarId: calId, externalId: ev.id, etag: ev.etag },
      }
    }

    if (method === 'update') {
      if (!binding) {
        // Not bound → treat as create
        return await handleIntentPush({ ...intent, action: 'create' }, token, defaultCalId)
      }
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(binding.calendarId)}/events/${encodeURIComponent(binding.externalId)}`)
      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        console.warn('[google.push] update failed', res.status, txt)
        return { ok: false, action: method, localId: local.id }
      }
      const ev: GoogleEvent = await res.json()
      return {
        ok: true,
        action: 'update',
        localId: local.id,
        bound: { provider: 'google', calendarId: binding.calendarId, externalId: ev.id, etag: ev.etag },
      }
    }

    if (method === 'delete') {
      if (!binding) {
        // Nothing to delete remotely
        return { ok: true, action: 'delete', localId: local.id }
      }
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(binding.calendarId)}/events/${encodeURIComponent(binding.externalId)}`)
      const res = await fetch(url.toString(), {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok && res.status !== 404) {
        const txt = await res.text().catch(() => '')
        console.warn('[google.push] delete failed', res.status, txt)
        return { ok: false, action: 'delete', localId: local.id }
      }
      return { ok: true, action: 'delete', localId: local.id }
    }

    // Unknown action → soft fail
    return { ok: false, action: method, localId: local.id }
  } catch (e) {
    console.warn('[google.push] failed', e)
    return { ok: false, action: method, localId: local.id }
  }
}
