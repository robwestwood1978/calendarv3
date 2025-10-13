// frontend/src/sync/push-bridge.ts
// Zero-touch write bridge: watches localStorage (fc_events_v1),
// diffs changes, and pushes creates/updates/deletes to Google.

import { createGoogleAdapter } from './google'
import type { PushIntent } from './types'
import type { EventRecord } from '../lib/recurrence'
import { readSyncConfig } from './core'

type ById = Record<string, EventRecord>

// ----- helpers ---------------------------------------------------------------

function parseEvents(raw: string | null): EventRecord[] {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw)
    // support either { events: [...] } or bare array
    if (Array.isArray(obj)) return obj as EventRecord[]
    if (Array.isArray(obj?.events)) return obj.events as EventRecord[]
    return []
  } catch {
    return []
  }
}

function indexById(list: EventRecord[]): ById {
  const m: ById = {}
  for (const e of list) if (e && (e as any).id) m[(e as any).id] = e
  return m
}

function equalShallow(a: EventRecord, b: EventRecord): boolean {
  // Compare the fields Google cares about; ignore local-only metadata
  return (
    a.title === b.title &&
    a.start === b.start &&
    a.end === b.end &&
    (a.allDay || false) === (b.allDay || false) &&
    (a.location || '') === (b.location || '') &&
    (a.notes || '') === (b.notes || '')
  )
}

function bindingForGoogle(e: EventRecord) {
  const r = (e as any)._remote
  if (!Array.isArray(r)) return undefined
  return r.find((x: any) => x?.provider === 'google')
}

// Build a single Google adapter from current config
function getGoogle() {
  const cfg = readSyncConfig()
  const g = cfg?.providers?.google
  if (!cfg?.enabled || !g?.enabled) return null
  const calendars =
    (Array.isArray(g.calendars) && g.calendars.length > 0) ? g.calendars : ['primary']
  return createGoogleAdapter({ calendars })
}

// ----- main installer --------------------------------------------------------

export function installGooglePushBridge() {
  let prevRaw = localStorage.getItem('fc_events_v1')
  let prevIdx = indexById(parseEvents(prevRaw))

  const runDiff = async () => {
    const google = getGoogle()
    if (!google) return

    const nowRaw = localStorage.getItem('fc_events_v1')
    if (nowRaw === prevRaw) return // no change

    const nowList = parseEvents(nowRaw)
    const nowIdx  = indexById(nowList)

    const intents: PushIntent[] = []

    // 1) Deletions
    for (const id in prevIdx) {
      if (!nowIdx[id]) {
        const oldEv = prevIdx[id]
        const bind = bindingForGoogle(oldEv)
        if (bind) intents.push({ action: 'delete', local: oldEv, target: bind })
      }
    }

    // 2) Creates + Updates
    for (const id in nowIdx) {
      const cur = nowIdx[id]
      const before = prevIdx[id]
      const bind = bindingForGoogle(cur)

      if (!before) {
        // New event
        intents.push(
          bind
            ? { action: 'update', local: cur, target: bind }
            : { action: 'create', local: cur, preferredTarget: { provider: 'google', calendarId: undefined } }
        )
      } else if (!equalShallow(cur, before)) {
        // Changed event
        intents.push(
          bind
            ? { action: 'update', local: cur, target: bind }
            : { action: 'create', local: cur, preferredTarget: { provider: 'google', calendarId: undefined } }
        )
      }
    }

    if (intents.length) {
      try {
        const results = await google.push(intents)
        const fail = results.find(r => !r.ok)
        if (fail) {
          window.dispatchEvent(new CustomEvent('toast', { detail: `Google save failed: ${fail.error || 'unknown'}` }))
        }
      } catch (e: any) {
        window.dispatchEvent(new CustomEvent('toast', { detail: `Google sync error: ${e?.message || e}` }))
      }
    }

    // update snapshot
    prevRaw = nowRaw
    prevIdx = nowIdx
  }

  // Run on local changes + periodic guard tick
  const onStorage = (e: StorageEvent | Event) => {
    try { runDiff() } catch {}
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('fc:events-changed', onStorage as any)

  // Poll as a fallback (handles same-tab writes that don’t fire storage)
  const interval = setInterval(runDiff, 1500)

  // immediate first pass
  runDiff().catch(() => {})

  // Expose a cleanup hook if you ever need it
  ;(window as any).__fc_uninstallGooglePush = () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('fc:events-changed', onStorage as any)
    clearInterval(interval)
  }
}
