// frontend/src/sync/localStore.ts
// Thin local-store adapter used by the sync engine.
// Persists to the same LocalStorage keys your app already uses.

import { LocalEvent } from './types'
import { getKeys, readJSON, writeJSON } from './storage'

const LS = getKeys()

type EventState = {
  events: LocalEvent[]
}

/** ------- helpers ------- */

function readAll(): LocalEvent[] {
  // your app has historically stored events under LS.EVENTS (fc_events_v1)
  const st = readJSON<EventState | LocalEvent[]>(LS.EVENTS, { events: [] } as any)
  // tolerate older shapes
  const list: LocalEvent[] = Array.isArray(st) ? st : Array.isArray((st as any).events) ? (st as any).events : []
  // sanitize minimal shape
  return list.filter(e => e && e.id && e.start && e.end)
}

function writeAll(list: LocalEvent[]) {
  // keep the same shape your app expects (array at root)
  writeJSON(LS.EVENTS, list)
  try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
}

/** Merge/upsert by id */
function upsertArray(base: LocalEvent[], rows: LocalEvent[]): LocalEvent[] {
  const byId = new Map<string, LocalEvent>(base.map(e => [e.id, e]))
  for (const row of rows) {
    const prev = byId.get(row.id)
    if (!prev) {
      byId.set(row.id, { ...row })
    } else {
      byId.set(row.id, { ...prev, ...row })
    }
  }
  return Array.from(byId.values())
}

/** ------- LocalStore implementation ------- */

export type LocalStore = {
  listRange(startISO: string, endISO: string): LocalEvent[]
  upsertMany(rows: LocalEvent[]): void
  applyDeletes(localIds: string[]): void
  rebind(localId: string, boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }): void
}

export function getLocalStore(): LocalStore {
  return {
    listRange(startISO: string, endISO: string) {
      const s = new Date(startISO).getTime()
      const e = new Date(endISO).getTime()
      const all = readAll()
      return all.filter(ev => {
        const a = new Date(ev.start).getTime()
        const b = new Date(ev.end).getTime()
        if (Number.isNaN(a) || Number.isNaN(b)) return false
        // overlap test
        return a < e && b > s
      })
    },

    upsertMany(rows: LocalEvent[]) {
      if (!rows || rows.length === 0) return
      const base = readAll()
      const next = upsertArray(base, rows)
      writeAll(next)
    },

    applyDeletes(localIds: string[]) {
      if (!localIds || localIds.length === 0) return
      const kill = new Set(localIds)
      const base = readAll()
      const next = base.filter(e => !kill.has(e.id))
      if (next.length !== base.length) writeAll(next)
    },

    rebind(localId, boundRef) {
      const base = readAll()
      const i = base.findIndex(e => e.id === localId)
      if (i === -1) return
      const ev = base[i]
      const remotes = Array.isArray((ev as any)._remote) ? (ev as any)._remote as any[] : []
      const existing = remotes.find(r => r?.provider === boundRef.provider)
      let nextRemotes: any[]
      if (existing) {
        nextRemotes = remotes.map(r => r?.provider === boundRef.provider ? { ...r, ...boundRef } : r)
      } else {
        nextRemotes = [...remotes, { ...boundRef }]
      }
      base[i] = { ...ev, _remote: nextRemotes as any }
      writeAll(base)
    },
  }
}
