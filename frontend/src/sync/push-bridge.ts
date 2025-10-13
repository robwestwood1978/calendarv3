// frontend/src/sync/push-bridge.ts
// Watches localStorage (fc_events_v1), diffs changes, pushes to Google,
// and writes back returned bindings so future edits hit the same event.

import { createGoogleAdapter } from './google'
import type { PushIntent, PushResult } from './types'
import type { EventRecord } from '../lib/recurrence'
import { readSyncConfig } from './core'

type ById = Record<string, EventRecord>

function parseEvents(raw: string | null): EventRecord[] {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw)
    if (Array.isArray(obj)) return obj as EventRecord[]
    if (Array.isArray(obj?.events)) return obj.events as EventRecord[]
    return []
  } catch { return [] }
}

function indexById(list: EventRecord[]): ById {
  const m: ById = {}
  for (const e of list) if (e && (e as any).id) m[(e as any).id] = e
  return m
}

function equalShallow(a: EventRecord, b: EventRecord): boolean {
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

function setBinding(e: EventRecord, bound: any) {
  const list = Array.isArray((e as any)._remote) ? (e as any)._remote.slice() : []
  const idx = list.findIndex((x: any) => x?.provider === 'google')
  if (idx >= 0) list[idx] = bound
  else list.push(bound)
  ;(e as any)._remote = list
}

function readCfg() {
  try { return readSyncConfig() } catch { return null }
}
function getGoogle() {
  const cfg = readCfg()
  const g = cfg?.providers?.google
  if (!cfg?.enabled || !g?.enabled) return null
  const calendars =
    (Array.isArray(g.calendars) && g.calendars.length > 0) ? g.calendars : ['primary']
  return createGoogleAdapter({ calendars })
}

function saveEvents(list: EventRecord[], asObjectForm: boolean) {
  // preserve original shape
  const raw = localStorage.getItem('fc_events_v1')
  try {
    const parsed = JSON.parse(raw || 'null')
    if (Array.isArray(parsed)) {
      localStorage.setItem('fc_events_v1', JSON.stringify(list))
    } else {
      localStorage.setItem('fc_events_v1', JSON.stringify({ ...(parsed || {}), events: list }))
    }
  } catch {
    localStorage.setItem('fc_events_v1', JSON.stringify(list))
  }
  window.dispatchEvent(new Event('storage'))
  window.dispatchEvent(new CustomEvent('fc:events-changed'))
}

export function installGooglePushBridge() {
  let prevRaw = localStorage.getItem('fc_events_v1')
  let prevList = parseEvents(prevRaw)
  let prevIdx = indexById(prevList)
  const objectForm = (() => { try { const p = JSON.parse(prevRaw || 'null'); return !Array.isArray(p) } catch { return false } })()

  const runDiff = async () => {
    const google = getGoogle()
    if (!google) return

    const nowRaw = localStorage.getItem('fc_events_v1')
    const nowList = parseEvents(nowRaw)
    const nowIdx  = indexById(nowList)

    // no visible change
    if (nowRaw === prevRaw) return

    const intents: PushIntent[] = []

    // deletions
    for (const id in prevIdx) {
      if (!nowIdx[id]) {
        const oldEv = prevIdx[id]
        const bind = bindingForGoogle(oldEv)
        if (bind) intents.push({ action: 'delete', local: oldEv, target: bind })
      }
    }

    // creates/updates
    for (const id in nowIdx) {
      const cur = nowIdx[id]
      const was = prevIdx[id]
      const bind = bindingForGoogle(cur)

      if (!was) {
        intents.push(
          bind
            ? { action: 'update', local: cur, target: bind }
            : { action: 'create', local: cur, preferredTarget: { provider: 'google', calendarId: undefined } }
        )
      } else if (!equalShallow(cur, was)) {
        intents.push(
          bind
            ? { action: 'update', local: cur, target: bind }
            : { action: 'create', local: cur, preferredTarget: { provider: 'google', calendarId: undefined } }
        )
      }
    }

    if (intents.length === 0) { prevRaw = nowRaw; prevList = nowList; prevIdx = nowIdx; return }

    let results: PushResult[] = []
    try {
      results = await google.push(intents)
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('toast', { detail: `Google sync error: ${e?.message || e}` }))
      // keep snapshot to avoid thrash but don’t write bindings
      prevRaw = nowRaw; prevList = nowList; prevIdx = nowIdx
      return
    }

    // apply returned bindings to current list
    let mutated = false
    for (const r of results) {
      if (!r.ok) {
        window.dispatchEvent(new CustomEvent('toast', { detail: `Google save failed: ${r.error || 'unknown'}` }))
        continue
      }
      if ((r.action === 'create' || r.action === 'update') && r.bound) {
        const ev = nowIdx[r.localId]
        if (ev) {
          setBinding(ev, r.bound)
          mutated = true
        }
      }
    }

    if (mutated) {
      // write back to storage with the same shape it had
      const mergedList = Object.values(nowIdx)
      saveEvents(mergedList, objectForm)
    }

    prevRaw = localStorage.getItem('fc_events_v1')
    prevList = parseEvents(prevRaw)
    prevIdx = indexById(prevList)
  }

  const onStorage = () => { runDiff().catch(() => {}) }
  window.addEventListener('storage', onStorage)
  window.addEventListener('fc:events-changed', onStorage as any)

  const interval = setInterval(() => runDiff().catch(() => {}), 1500)

  runDiff().catch(() => {})

  ;(window as any).__fc_uninstallGooglePush = () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('fc:events-changed', onStorage as any)
    clearInterval(interval)
  }
}
