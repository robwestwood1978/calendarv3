// Minimal bridge to your existing local store. Replace internals if your app uses another layer.

import type { LocalEvent } from './types'

const LS_KEY = 'fc_events_v1'  // your app already writes here

function readAll(): LocalEvent[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function writeAll(rows: LocalEvent[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(rows))
  try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
}

function overlaps(aISO: string, bISO: string, startISO: string, endISO: string) {
  const a = new Date(aISO).getTime()
  const b = new Date(bISO).getTime()
  const s = new Date(startISO).getTime()
  const e = new Date(endISO).getTime()
  return (a <= e) && (b >= s)
}

export const storeBridge = {
  listRange(startISO: string, endISO: string): LocalEvent[] {
    return readAll().filter(r => overlaps(r.start, r.end, startISO, endISO))
  },
  upsertMany(rows: LocalEvent[]) {
    const all = readAll()
    const byId = new Map(all.map(r => [r.id, r]))
    for (const r of rows) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r })
    writeAll(Array.from(byId.values()))
  },
  applyDeletes(localIds: string[]) {
    if (!localIds?.length) return
    const next = readAll().filter(r => !localIds.includes(r.id))
    writeAll(next)
  },
  rebind(localId: string, boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }) {
    const all = readAll()
    const i = all.findIndex(r => r.id === localId)
    if (i < 0) return
    const remotes = Array.isArray((all[i] as any)._remote) ? [...(all[i] as any)._remote] : []
    const ix = remotes.findIndex((r: any) => r.provider === boundRef.provider)
    if (ix >= 0) remotes[ix] = boundRef
    else remotes.push(boundRef)
    ;(all[i] as any)._remote = remotes
    writeAll(all)
  }
}
