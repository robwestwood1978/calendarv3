// frontend/src/sync/journalizer.ts
// Duplicate-safe, remote-aware journalizer.
// Keeps a shadow copy of the local events. On changes, computes a minimal diff
// and records only *local* mutations to the journal (create / update / delete).

import { LocalEvent, JournalAction } from './types'
import { getKeys, readJSON, writeJSON } from './storage'
import { recordMutation } from './journal'

const LS = getKeys()

type ShadowState = {
  rev: number
  byId: Record<string, LocalEvent>
}

function readShadow(): ShadowState {
  return readJSON<ShadowState>(LS.SYNC_SHADOW, { rev: 0, byId: {} })
}
function writeShadow(st: ShadowState) {
  writeJSON(LS.SYNC_SHADOW, st)
}

function keyOf(e: LocalEvent) {
  // fields that affect external write
  return JSON.stringify({
    title: e.title || '',
    start: e.start, end: e.end,
    allDay: !!e.allDay,
    location: e.location || '',
    notes: e.notes || '',
  })
}

function looksRemoteOnlyChange(next: LocalEvent, prev?: LocalEvent): boolean {
  // if only _remote array/etag changes (coming from pull), skip journaling
  if (!prev) return false
  const coreNext = keyOf(next)
  const corePrev = keyOf(prev)
  return coreNext === corePrev
}

export function startJournalizer() {
  // Build initial shadow
  const st0 = readShadow()
  if (st0.rev === 0) {
    const now = readLocal()
    const byId: Record<string, LocalEvent> = {}
    for (const e of now) byId[e.id] = e
    writeShadow({ rev: 1, byId })
  }

  function onTick() {
    try {
      const cur = readLocal()
      const sh = readShadow()

      const curById: Record<string, LocalEvent> = {}
      for (const e of cur) curById[e.id] = e

      // Detect deletions
      for (const id of Object.keys(sh.byId)) {
        if (!curById[id]) {
          // deletion (local only). Do not journal if previous had a google binding and we suspect a remote delete pull?
          // We still record local delete so push can propagate.
          recordMutation('delete' as JournalAction, sh.byId[id], undefined, id)
        }
      }

      // Detect creates/updates
      for (const e of cur) {
        const prev = sh.byId[e.id]
        if (!prev) {
          // new
          recordMutation('create' as JournalAction, undefined, e, e.id)
        } else {
          const beforeKey = keyOf(prev)
          const afterKey = keyOf(e)
          if (afterKey !== beforeKey) {
            // skip if change is only remote metadata (_remote changed)
            if (!looksRemoteOnlyChange(e, prev)) {
              recordMutation('update' as JournalAction, prev, e, e.id)
            }
          }
        }
      }

      // Update shadow
      const byId: Record<string, LocalEvent> = {}
      for (const e of cur) byId[e.id] = e
      writeShadow({ rev: sh.rev + 1, byId })

      try { console.log('[journalizer] shadow updated. events:', cur.length) } catch {}
      try { window.dispatchEvent(new CustomEvent('fc:journal-tick')) } catch {}
    } catch (err) {
      try { console.warn('[journalizer] error', err) } catch {}
    }
  }

  // tick when local events change or periodically from sync loop
  window.addEventListener('fc:events-changed', onTick)
  window.addEventListener('fc:journal-poll', onTick)
  // Prime first run
  setTimeout(onTick, 0)
}

function readLocal(): LocalEvent[] {
  try {
    const raw = localStorage.getItem(LS.EVENTS)
    if (!raw) return []
    const val = JSON.parse(raw)
    return Array.isArray(val) ? val as LocalEvent[] : Array.isArray(val?.events) ? val.events : []
  } catch { return [] }
}
