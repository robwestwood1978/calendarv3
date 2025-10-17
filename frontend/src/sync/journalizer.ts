// Diff-based journalizer: snapshots local events and appends Journal entries.
// Emits minimal logs so you can see what it’s doing.

import { readJSON, writeJSON } from './storage'
import { recordMutation } from './journal'
import type { LocalEvent } from './types'

const SHADOW_KEY = 'fc_journal_shadow_v1'

// How to read your app’s current events.
// If you already have a selector, swap this to use it. This version reads the
// canonical list the app persists in localStorage (fc_events_v1 or v2/v3).
function readAllLocalEvents(): LocalEvent[] {
  // Try most recent first; fall back if needed
  const keys = ['fc_events_v3', 'fc_events_v2', 'fc_events_v1']
  for (const k of keys) {
    const val = localStorage.getItem(k)
    if (val) {
      try {
        const arr = JSON.parse(val)
        if (Array.isArray(arr)) return arr as LocalEvent[]
      } catch {}
    }
  }
  // Fallback to in-memory slice if app exposes it.
  const w: any = window as any
  if (Array.isArray(w.__FC_EVENTS__)) return w.__FC_EVENTS__ as LocalEvent[]
  return []
}

function indexById(list: LocalEvent[]) {
  const m = new Map<string, LocalEvent>()
  for (const e of list) if (e && e.id) m.set(e.id, e)
  return m
}

function shallowComparable(ev: LocalEvent) {
  // Only the fields we sync (to keep diff cheap + deterministic)
  return {
    id: ev.id,
    title: ev.title || '',
    start: ev.start,
    end: ev.end,
    allDay: !!(ev as any).allDay,
    location: ev.location || undefined,
    notes: ev.notes || undefined,
    attendees: (ev as any).attendees || undefined,
    tags: (ev as any).tags || undefined,
    colour: (ev as any).colour || undefined,
    _remote: (ev as any)._remote || undefined,
  }
}

function equal(a: any, b: any) {
  return JSON.stringify(a) === JSON.stringify(b)
}

let ticking = false

export function startJournalizer() {
  if ((window as any).__journalizerOn) return
  ;(window as any).__journalizerOn = true

  const run = () => {
    if (ticking) return
    ticking = true
    try {
      const now = Date.now()
      const current = readAllLocalEvents()
      const prev = readJSON<LocalEvent[]>(SHADOW_KEY, [])
      const currIdx = indexById(current)
      const prevIdx = indexById(prev)

      let wrote = 0

      // Detect creates & updates
      for (const cur of current) {
        const p = prevIdx.get(cur.id)
        if (!p) {
          recordMutation('create', undefined, shallowComparable(cur), cur.id)
          wrote++
        } else {
          const a = shallowComparable(p)
          const b = shallowComparable(cur)
          if (!equal(a, b)) {
            recordMutation('update', a, b, cur.id)
            wrote++
          }
        }
      }

      // Detect deletes
      for (const p of prev) {
        if (!currIdx.has(p.id)) {
          recordMutation('delete', shallowComparable(p), undefined, p.id)
          wrote++
        }
      }

      // Update shadow
      writeJSON(SHADOW_KEY, current)

      if (wrote) {
        // Helpful log noise only when something changed
        console.log('[journalizer] wrote', wrote, 'entries at', new Date(now).toISOString())
      } else {
        // Quieter trace you can comment out if too chatty
        // console.log('[journalizer] no diff')
      }
    } catch (e) {
      console.warn('[journalizer] error', e)
    } finally {
      ticking = false
    }
  }

  // Run when your app announces local changes
  window.addEventListener('fc:events-changed', run)
  window.addEventListener('storage', run)

  // Kick once on load (build the initial shadow)
  setTimeout(run, 0)

  // Expose a manual nudge for debugging
  ;(window as any).__forceJournalScan = run
}
