// frontend/src/sync/google.ts
// PATCH v3.1 — Google Sync Reliability + Verbose Diagnostics Build (2025-10-22)
// - Robust pull: proper syncToken usage, windowed fallback on 400/409/410, 429 backoff
// - Safe push: CREATE/PATCH/DELETE with If-Match (when we have etag), 412 recovery
// - Correct all-day mapping (inclusive local → exclusive Google)
// - Strong date guards (prevents “RangeError: Invalid Date”)
// - Duplicate defense: never POST when a Google binding exists; return binding on success
// - Structured logs: [google], [pull], [push] with compact helpful payload snippets

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult, LocalEvent } from './types'
import { getAccessToken } from '../google/oauth'

/* --------------------------- Types & Utilities --------------------------- */

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

const LOG_ON = true
const log = (...a: any[]) => { if (LOG_ON) console.log(...a) }
const warn = (...a: any[]) => { if (LOG_ON) console.warn(...a) }

/** guard: safe Date → ISO, returns undefined on invalid */
function toISO(z?: string) {
  if (!z) return undefined
  const d = new Date(z)
  return Number.isFinite(+d) ? d.toISOString() : undefined
}

function brief(ev: Partial<LocalEvent> | undefined) {
  if (!ev) return ev
  return {
    id: ev.id,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    allDay: (ev as any).allDay,
  }
}

/* -------------------------- Pull mapping (Google → Local) -------------------------- */

function mapGoogleToLocal(g: GoogleEvent) {
  // Skip malformed
  if (!g?.start || !g?.end) return null

  const isAllDay = !!g.start.date && !!g.end.date

  const startISO = isAllDay
    ? toISO(`${g.start!.date}T00:00:00Z`)
    : toISO(g.start!.dateTime)

  // Google all-day end is exclusive → convert to inclusive 23:59:59.999 by subtracting 1ms
  const endExclusiveISO = isAllDay
    ? toISO(`${g.end!.date}T00:00:00Z`)
    : toISO(g.end!.dateTime)

  if (!startISO || !endExclusiveISO) return null

  const endISO = isAllDay
    ? new Date(new Date(endExclusiveISO).getTime() - 1).toISOString()
    : endExclusiveISO

  const rrule = Array.isArray(g.recurrence)
    ? g.recurrence.find(r => typeof r === 'string' && r.toUpperCase().startsWith('RRULE:'))
    : undefined

  const attendees = Array.isArray(g.attendees)
    ? g.attendees.map(a => a?.email || a?.displayName || '').filter(Boolean)
    : undefined

  return {
    id: g.id, // instance id (unique occurrence id when singleEvents=true)
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
      calendarId: '', // filled in by caller
      externalId: g.id,
      etag: g.etag,
    }],
  } as Partial<LocalEvent> & { _remote: any[] }
}

/* ------------------------------- Fetch helpers ------------------------------- */

async function gfetchJSON<T = any>(path: string, params: Record<string, string>): Promise<T> {
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

async function gfetchBody<T = any>(
  method: 'POST' | 'PATCH' | 'DELETE' | 'GET',
  path: string,
  body?: any,
  etag?: string | null
): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('401')
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (body) headers['Content-Type'] = 'application/json'
  if (etag) headers['If-Match'] = etag

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 412) throw new Error('412') // precondition failed (etag mismatch)
  if (res.status === 429) throw new Error('429')
  if (res.status === 401) throw new Error('401')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}:${text}`)
  }
  try { return (await res.json()) as T } catch { return undefined as any }
}

/* ------------------------------ Date logic (Local → Google) ------------------------------ */

function isAllDayLocal(ev: LocalEvent): boolean {
  if ((ev as any).allDay) return true
  try {
    const s = new Date(ev.start)
    const e = new Date(ev.end)
    if (!Number.isFinite(+s) || !Number.isFinite(+e)) return !!(ev as any).allDay
    // Consider “full day” spans with inclusive end, or exact midnight-to-midnight-1ms
    const startsMidnightUTC = s.getUTCHours() === 0 && s.getUTCMinutes() === 0 && s.getUTCSeconds() === 0 && s.getUTCMilliseconds() === 0
    const inclusiveEnd = e.getUTCHours() === 23 && e.getUTCMinutes() === 59 && e.getUTCSeconds() === 59 && e.getUTCMilliseconds() === 999
    const zeroLenMidnight = s.getTime() === e.getTime() // defensive
    return startsMidnightUTC && (inclusiveEnd || zeroLenMidnight)
  } catch {
    return !!(ev as any).allDay
  }
}

function toGoogleBody(ev: LocalEvent, tz?: string) {
  // validate dates early; throw to surface a meaningful log
  const s = new Date(ev.start)
  const e = new Date(ev.end)
  if (!Number.isFinite(+s) || !Number.isFinite(+e)) {
    throw new RangeError('Invalid Date')
  }

  const allDay = isAllDayLocal(ev)
  if (allDay) {
    // Convert inclusive local end → Google exclusive date
    // If end is 23:59:59.999 of day D, exclusive date is D+1
    const endExclusive = new Date(e.getTime() + 1)
    const endDate = new Date(Date.UTC(
      endExclusive.getUTCFullYear(),
      endExclusive.getUTCMonth(),
      endExclusive.getUTCDate()
    ))
    const startDate = new Date(Date.UTC(
      s.getUTCFullYear(),
      s.getUTCMonth(),
      s.getUTCDate()
    ))
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

    return {
      summary: ev.title || '(No title)',
      description: (ev as any).notes || '',
      location: (ev as any).location || undefined,
      start: { date: dateStr(startDate) },
      end: { date: dateStr(endDate) },
    }
  }

  // Timed event
  return {
    summary: ev.title || '(No title)',
    description: (ev as any).notes || '',
    location: (ev as any).location || undefined,
    start: { dateTime: new Date(ev.start).toISOString(), timeZone: tz || undefined },
    end: { dateTime: new Date(ev.end).toISOString(), timeZone: tz || undefined },
  }
}

/* -------------------------------- Adapter -------------------------------- */

export function createGoogleAdapter(opts: { accountKey?: string; calendars?: string[] }): ProviderAdapter {
  const calendars = opts.calendars && opts.calendars.length ? opts.calendars : ['primary']

  return {
    provider: 'google',

    /* ------------------------------ PULL ------------------------------ */
    async pull({ sinceToken, rangeStartISO, rangeEndISO }) {
      const events: RemoteDelta[] = []
      let nextSyncToken: string | null = null

      for (const calId of calendars) {
        let pageToken: string | undefined
        let useSyncToken = !!sinceToken

        // Defensive: window bounds must be valid
        const tmin = new Date(rangeStartISO)
        const tmax = new Date(rangeEndISO)
        const tminISO = Number.isFinite(+tmin) ? tmin.toISOString() : new Date().toISOString()
        const tmaxISO = Number.isFinite(+tmax) && +tmax > +tmin ? tmax.toISOString() : new Date(+tmin + 60_000).toISOString()

        while (true) {
          const params: Record<string, string> = {
            maxResults: '2500',
            showDeleted: 'true',
            singleEvents: 'true',
          }

          if (useSyncToken && sinceToken) {
            // IMPORTANT: NO orderBy when using syncToken
            params.syncToken = sinceToken
          } else {
            // Window mode
            params.orderBy = 'startTime'
            params.timeMin = tminISO
            params.timeMax = tmaxISO
          }

          if (pageToken) params.pageToken = pageToken

          let data: ListResp
          try {
            data = await gfetchJSON<ListResp>(`/calendars/${encodeURIComponent(calId)}/events`, params)
          } catch (e: any) {
            const code = e?.message || ''
            if (code === '429') {
              warn('[pull] 429: backoff 800ms')
              await new Promise(r => setTimeout(r, 800))
              continue
            }
            if (code === '409' || code === '410' || code === '400') {
              // invalid/expired token OR ordering with token — switch to windowed pull
              warn(`[pull] ${code}: switching to windowed mode for ${calId}`)
              useSyncToken = false
              pageToken = undefined
              continue
            }
            warn('[pull] failed:', e)
            throw e
          }

          const items = Array.isArray(data.items) ? data.items : []

          for (const g of items) {
            // Skip series masters when singleEvents=true unless it still slips through
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

      log('[pull] events:', events.length, 'token:', !!nextSyncToken)
      return { token: nextSyncToken || sinceToken || null, events }
    },

    /* ------------------------------ PUSH ------------------------------ */
    async push(intents: PushIntent[]) {
      const results: PushResult[] = []
      if (!Array.isArray(intents) || intents.length === 0) return results

      for (const it of intents) {
        // Each intent MUST carry a LocalEvent in it.local (your core runner constructs it)
        const ev = it.local as LocalEvent
        const remote = Array.isArray((ev as any)._remote) ? (ev as any)._remote : []
        const gBind = remote.find((r: any) => r?.provider === 'google')
        const calendarId: string = (gBind?.calendarId) || (calendars[0] || 'primary')

        try {
          if (it.action === 'delete') {
            if (!gBind?.externalId) {
              // no Google binding → nothing to delete; treat as success to drain the journal
              results.push({ ok: true, action: 'delete', localId: ev.id })
              continue
            }
            const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(gBind.externalId)}`
            log('[push] DELETE', { path, brief: brief(ev) })
            await gfetchBody('DELETE', path, undefined, gBind.etag || null)
            results.push({ ok: true, action: 'delete', localId: ev.id })
            continue
          }

          // CREATE or UPDATE
          // - Never CREATE if a binding exists (prevents duplicates)
          // - UPDATE uses If-Match when we have etag; on 412, GET fresh & retry without If-Match
          const body = toGoogleBody(ev, (ev as any).timezone)

          if (!gBind) {
            // CREATE
            const path = `/calendars/${encodeURIComponent(calendarId)}/events`
            log('[push] POST', { path, body: { ...body, description: body.description ? '…' : '' }, brief: brief(ev) })
            const created = await gfetchBody<GoogleEvent>('POST', path, body)
            results.push({
              ok: true,
              action: 'create',
              localId: ev.id,
              bound: {
                provider: 'google',
                calendarId,
                externalId: created.id,
                etag: created.etag,
              },
            })
          } else {
            // UPDATE
            const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(gBind.externalId)}`
            const tryPatch = async (useEtag: boolean) => {
              log('[push] PATCH', { path, ifMatch: useEtag ? gBind.etag : null, brief: brief(ev) })
              return await gfetchBody<GoogleEvent>('PATCH', path, body, useEtag ? (gBind.etag || null) : null)
            }

            let updated: GoogleEvent | undefined
            try {
              // optimistic with etag (when we have one)
              updated = await tryPatch(!!gBind.etag)
            } catch (e: any) {
              if ((e?.message || '').startsWith('412')) {
                // ETag mismatch: fetch latest then retry without If-Match
                warn('[push] 412: refetching latest, then retrying PATCH without If-Match')
                const fresh = await gfetchBody<GoogleEvent>(
                  'GET',
                  `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(gBind.externalId)}`
                )
                // Optionally merge here if you want field-level reconciliation. For now we respect local source of truth.
                updated = await tryPatch(false)
              } else if ((e?.message || '').startsWith('404')) {
                // Remote vanished → create anew
                warn('[push] 404 on update: creating new event')
                const created = await gfetchBody<GoogleEvent>('POST',
                  `/calendars/${encodeURIComponent(calendarId)}/events`, body)
                results.push({
                  ok: true,
                  action: 'create',
                  localId: ev.id,
                  bound: {
                    provider: 'google',
                    calendarId,
                    externalId: created.id,
                    etag: created.etag,
                  },
                })
                continue
              } else if ((e?.message || '').startsWith('429')) {
                warn('[push] 429: backoff 800ms and retry PATCH once')
                await new Promise(r => setTimeout(r, 800))
                updated = await tryPatch(!!gBind.etag)
              } else {
                throw e
              }
            }

            if (updated) {
              results.push({
                ok: true,
                action: 'update',
                localId: ev.id,
                bound: {
                  provider: 'google',
                  calendarId,
                  externalId: updated.id,
                  etag: updated.etag,
                },
              })
            } else {
              // If we somehow got here, treat as soft success to avoid journal loop
              results.push({ ok: true, action: 'update', localId: ev.id })
            }
          }
        } catch (err: any) {
          warn('[google.push] failed', err, 'event:', brief(ev))
          results.push({ ok: false, action: it.action, localId: ev.id, error: String(err?.message || err) })
        }
      }

      const ok = results.filter(r => r.ok).length
      log('[push] results:', ok, 'of', results.length)
      return results
    },
  }
}
