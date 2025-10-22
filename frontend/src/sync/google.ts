// Google Calendar adapter: fast stitch + stable IDs + client-wins debounce
// - Stable local IDs on pull (prefer fc_local_id → recent bind → g:<externalId>)
// - Recent-bind cache to stitch fresh remote rows back to existing local rows
// - Push-before-pull friendly (adapter stays stateless, runner triggers ordering)
// - Debounce guard to skip stale remote deltas briefly after our push
// - 412 retry, 409/410/400 syncToken fallback, 429 backoff
// - Correct all-day mapping

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult, LocalEvent } from './types'
import { getAccessToken } from '../google/oauth'
import { diag } from './diag'

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
  extendedProperties?: {
    private?: Record<string, string>
    shared?: Record<string, string>
  }
}

type ListResp = {
  items?: GoogleEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

const MARKER_KEY = 'fc_local_id' // our idempotency marker

/* ---------------- client-wins debounce guard ---------------- */

const GUARD_PREFIX = 'fc_push_guard_'
const GUARD_WINDOW_MS = 12_000

function guardKey(localId: string) { return `${GUARD_PREFIX}${localId}` }
function markJustPushed(localId?: string) { if (localId) try { localStorage.setItem(guardKey(localId), String(Date.now())) } catch {} }
function isGuarded(localId?: string): boolean {
  if (!localId) return false
  try {
    const raw = localStorage.getItem(guardKey(localId)); if (!raw) return false
    const ts = Number(raw); if (!Number.isFinite(ts)) return false
    return (Date.now() - ts) <= GUARD_WINDOW_MS
  } catch { return false }
}

/* ---------------- recent-binding cache (stitching) ---------------- */

const recentByExternal = new Map<string, { localId: string, ts: number }>()
const RECENT_TTL = 20_000

function rememberBinding(externalId: string, localId: string) {
  recentByExternal.set(externalId, { localId, ts: Date.now() })
}
function lookupRecentLocalId(externalId?: string): string | undefined {
  if (!externalId) return
  const hit = recentByExternal.get(externalId)
  if (hit && (Date.now() - hit.ts) <= RECENT_TTL) return hit.localId
  if (hit) recentByExternal.delete(externalId)
}

/* ---------------- utilities ---------------- */

function toISO(z?: string) { if (!z) return; const d = new Date(z); return isNaN(+d) ? undefined : d.toISOString() }
function isValidISO(s?: string) { if (!s) return false; const d = new Date(s); return !isNaN(+d) }

/** Map Google → Local, forcing a stable local id (prefer marker or stitched localId) */
function mapGoogleToLocal(g: GoogleEvent, calId: string, preferLocalId?: string | null) {
  const isAllDay = !!g.start?.date && !!g.end?.date

  const startISO = isAllDay ? toISO(`${g.start!.date}T00:00:00Z`) : toISO(g.start?.dateTime)
  const endExclusiveISO = isAllDay ? toISO(`${g.end!.date}T00:00:00Z`) : toISO(g.end?.dateTime)
  if (!startISO || !endExclusiveISO) return null
  const endISO = isAllDay ? new Date(new Date(endExclusiveISO).getTime() - 1).toISOString() : endExclusiveISO

  const rrule = Array.isArray(g.recurrence) ? g.recurrence.find(x => x.toUpperCase().startsWith('RRULE:')) : undefined
  const attendees = Array.isArray(g.attendees) ? g.attendees.map(a => a?.email || a?.displayName || '').filter(Boolean) : undefined

  // *** The critical change: choose a stable local id that points at the existing row ***
  // 1) Marker from Google (our own localId we wrote earlier)
  // 2) Recently pushed binding for this Google externalId (immediate stitch)
  // 3) Otherwise, a deterministic namespace to avoid colliding with real local ids
  const stitchedLocalId =
    preferLocalId ||
    lookupRecentLocalId(g.id) ||
    `g:${g.id}`

  return {
    id: stitchedLocalId,
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
      calendarId: calId,
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
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  if (etag) headers['If-Match'] = etag
  const res = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (res.status === 412) throw new Error('412')
  if (!res.ok) { const text = await res.text().catch(() => ''); throw new Error(`${res.status}:${text}`) }
  try { return (await res.json()) as T } catch { return undefined as any }
}

function isAllDayLocal(ev: LocalEvent): boolean {
  if (ev.allDay) return true
  if (!isValidISO(ev.start) || !isValidISO(ev.end)) return false
  const s = new Date(ev.start!), e = new Date(ev.end!)
  const startsMidnight = s.getUTCHours() === 0 && s.getUTCMinutes() === 0 && s.getUTCSeconds() === 0
  const endsAt59 = e.getUTCHours() === 23 && e.getUTCMinutes() === 59
  const msInclusive = (e.getTime() - s.getTime()) + 1
  const fullDays = (msInclusive % (24 * 60 * 60 * 1000)) === 0
  return startsMidnight && (endsAt59 || fullDays)
}

function toGoogleBody(ev: LocalEvent, tz?: string) {
  if (!isValidISO(ev.start) || !isValidISO(ev.end)) throw new RangeError('Invalid Date')
  const body: any = {
    summary: ev.title || '(No title)',
    description: ev.notes || '',
    location: ev.location || undefined,
  }
  const allDay = isAllDayLocal(ev)
  if (allDay) {
    const s = new Date(ev.start!), e = new Date(ev.end!)
    const endExclusive = new Date(e.getTime() + 1)
    const endDate = new Date(Date.UTC(endExclusive.getUTCFullYear(), endExclusive.getUTCMonth(), endExclusive.getUTCDate()))
    const startDate = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`
    body.start = { date: dateStr(startDate) }
    body.end   = { date: dateStr(endDate) }
  } else {
    body.start = { dateTime: new Date(ev.start!).toISOString(), timeZone: tz || undefined }
    body.end   = { dateTime: new Date(ev.end!).toISOString(),   timeZone: tz || undefined }
  }
  // ensure marker travels with every push
  const priv = { [MARKER_KEY]: String(ev.id || '') }
  body.extendedProperties = Object.assign({}, body.extendedProperties || {}, { private: Object.assign({}, body.extendedProperties?.private || {}, priv) })
  return body
}

/** find an existing Google event by our private local-id marker (bounded scan) */
async function findByMarker(calendarId: string, localId: string): Promise<GoogleEvent | null> {
  try {
    const now = new Date()
    const timeMin = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()
    let pageToken: string | undefined
    for (let guard = 0; guard < 6; guard++) {
      const resp = await gfetchJSON<ListResp>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        singleEvents: 'true', showDeleted: 'false',
        timeMin, timeMax, maxResults: '250', ...(pageToken ? { pageToken } : {}),
      })
      const items = resp.items || []
      for (let i = 0; i < items.length; i++) {
        const g = items[i]
        const mark = g?.extendedProperties?.private?.[MARKER_KEY]
        if (mark === localId) return g
      }
      if (!resp.nextPageToken) break
      pageToken = resp.nextPageToken
    }
    return null
  } catch { return null }
}

/* ---------------- adapter ---------------- */

export function createGoogleAdapter(opts: { accountKey?: string; calendars?: string[] }): ProviderAdapter {
  const calendars = (opts && Array.isArray(opts.calendars) && opts.calendars.length) ? opts.calendars : ['primary']

  return {
    provider: 'google',

    async pull({ sinceToken, rangeStartISO, rangeEndISO }) {
      const events: RemoteDelta[] = []
      let nextSyncToken: string | null = null

      for (let c = 0; c < calendars.length; c++) {
        const calId = calendars[c]
        let pageToken: string | undefined
        let useSyncToken = !!sinceToken

        while (true) {
          const params: Record<string, string> = { maxResults: '2500', showDeleted: 'true', singleEvents: 'true' }
          if (useSyncToken && sinceToken) {
            params.syncToken = sinceToken
          } else {
            params.orderBy = 'startTime'
            const tmin = new Date(rangeStartISO).toISOString()
            const tmax0 = new Date(rangeEndISO).toISOString()
            const tmax = (new Date(tmax0).getTime() <= new Date(tmin).getTime())
              ? new Date(new Date(tmin).getTime() + 60_000).toISOString()
              : tmax0
            params.timeMin = tmin; params.timeMax = tmax
          }
          if (pageToken) params.pageToken = pageToken

          let data: ListResp
          try {
            data = await gfetchJSON<ListResp>(`/calendars/${encodeURIComponent(calId)}/events`, params)
          } catch (e: any) {
            const code = e?.message
            if (code === '409' || code === '410' || code === '400') { useSyncToken = false; pageToken = undefined; continue }
            if (code === '429') { await new Promise(r => setTimeout(r, 800 + Math.random()*400)); continue }
            throw e
          }

          const items = Array.isArray(data.items) ? data.items : []
          for (let i = 0; i < items.length; i++) {
            const g = items[i]
            const isMaster = Array.isArray(g.recurrence) && g.recurrence.length > 0 && !g.originalStartTime
            if (isMaster) continue

            const markLocalId = g?.extendedProperties?.private?.[MARKER_KEY]

            // Debounce: skip stale remote for just-pushed local ids
            if (markLocalId && isGuarded(markLocalId)) {
              diag.pull({ provider: 'google', kind: 'pull.skip.guard', localId: markLocalId, externalId: g.id })
              continue
            }

            if (g.status === 'cancelled') {
              events.push({ operation: 'delete', calendarId: calId, externalId: g.id })
              continue
            }

            // *** Stitch to existing local row via marker OR recent binding ***
            const preferredId = markLocalId || lookupRecentLocalId(g.id)
            const payload = mapGoogleToLocal(g, calId, preferredId || null)
            if (!payload) continue

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
      if (!intents || intents.length === 0) return results

      for (let k = 0; k < intents.length; k++) {
        const it = intents[k]
        const ev: LocalEvent | undefined = it.local as any
        const remoteList = (ev && (ev as any)._remote && Array.isArray((ev as any)._remote)) ? ((ev as any)._remote as any[]) : []
        const boundGoogle = remoteList.find(r => r && r.provider === 'google')
        const calendarId = (boundGoogle && boundGoogle.calendarId) ? boundGoogle.calendarId : (calendars[0] || 'primary')

        try {
          if (it.action === 'delete') {
            if (boundGoogle && boundGoogle.externalId) {
              await gfetchBody('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(boundGoogle.externalId)}`)
              markJustPushed(ev?.id)
              rememberBinding(boundGoogle.externalId, ev?.id || '') // harmless; allows stitch if Google echoes a ghost row
              results.push({ ok: true, action: 'delete', localId: ev?.id })
              continue
            }
            if (ev?.id) {
              const foundForDelete = await findByMarker(calendarId, ev.id)
              if (foundForDelete) await gfetchBody('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(foundForDelete.id)}`)
              markJustPushed(ev.id)
            }
            results.push({ ok: true, action: 'delete', localId: ev?.id })
            continue
          }

          if (!ev) { results.push({ ok: false, action: it.action, localId: undefined, error: 'missing local snapshot' }); continue }

          const body = toGoogleBody(ev, (ev as any)?.timezone)

          if (!boundGoogle || !boundGoogle.externalId) {
            const found = ev.id ? await findByMarker(calendarId, ev.id) : null
            if (found) {
              const updated = await gfetchBody<GoogleEvent>('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(found.id)}`, body, found.etag)
              markJustPushed(ev.id); rememberBinding(updated.id, ev.id)
              results.push({ ok: true, action: 'update', localId: ev.id, bound: { provider: 'google', calendarId, externalId: updated.id, etag: updated.etag } })
            } else {
              const created = await gfetchBody<GoogleEvent>('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, body)
              markJustPushed(ev.id); rememberBinding(created.id, ev.id)
              results.push({ ok: true, action: 'create', localId: ev.id, bound: { provider: 'google', calendarId, externalId: created.id, etag: created.etag } })
            }
          } else {
            const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(boundGoogle.externalId)}`
            try {
              const updated = await gfetchBody<GoogleEvent>('PATCH', path, body, boundGoogle.etag)
              markJustPushed(ev.id); rememberBinding(updated.id, ev.id)
              results.push({ ok: true, action: 'update', localId: ev.id, bound: { provider: 'google', calendarId, externalId: updated.id, etag: updated.etag } })
            } catch (err: any) {
              if (String(err?.message || '').startsWith('412')) {
                const updated = await gfetchBody<GoogleEvent>('PATCH', path, body)
                markJustPushed(ev.id); rememberBinding(updated.id, ev.id)
                results.push({ ok: true, action: 'update', localId: ev.id, bound: { provider: 'google', calendarId, externalId: updated.id, etag: updated.etag } })
              } else {
                throw err
              }
            }
          }
        } catch (err: any) {
          diag.google({ msg: 'push.fail', error: String(err?.message || err), action: it.action, localId: ev?.id })
          results.push({ ok: false, action: it.action, localId: ev?.id, error: String(err?.message || err) })
        }
      }

      return results
    },
  }
}
