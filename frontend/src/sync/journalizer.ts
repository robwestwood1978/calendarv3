// Watches your local events (fc_events_v1) and writes create/update/delete
// entries into YOUR existing journal via recordMutation().

import { recordMutation } from './journal'

type LocalEvent = {
  id: string
  title?: string
  start: string
  end: string
  allDay?: boolean
  location?: string
  notes?: string
  // keep any other fields you care about — we only compare key fields
}

const EVENTS_LS = 'fc_events_v1'
const SHADOW_LS = 'fc_journal_shadow_v1'

// ---- helpers ----
function readEvents(): LocalEvent[] {
  try { return JSON.parse(localStorage.getItem(EVENTS_LS) || '[]') } catch { return [] }
}
function indexById(rows: LocalEvent[]) {
  const m: Record<string, LocalEvent> = {}
  for (const r of rows) if (r?.id) m[r.id] = r
  return m
}
function readShadow(): Record<string, LocalEvent> {
  try { return JSON.parse(localStorage.getItem(SHADOW_LS) || '{}') } catch { return {} }
}
function writeShadow(map: Record<string, LocalEvent>) {
  localStorage.setItem(SHADOW_LS, JSON.stringify(map))
}
function keySlice(e?: LocalEvent) {
  if (!e) return null
  // only fields that matter to a remote provider
  const s = {
    title: e.title || '',
    start: e.start, end: e.end,
    allDay: !!e.allDay,
    location: e.location || '',
    notes: e.notes || '',
  }
  return s
}
function equal(a?: LocalEvent, b?: LocalEvent) {
  return JSON.stringify(keySlice(a)) === JSON.stringify(keySlice(b))
}

// ---- core diff ----
function diffAndJournalize() {
  const beforeMap = readShadow()
  const nowMap = indexById(readEvents())

  // creates & updates
  for (const id of Object.keys(nowMap)) {
    const prev = beforeMap[id]
    const cur  = nowMap[id]
    if (!prev) {
      recordMutation('create', undefined, keySlice(cur)!, id)
    } else if (!equal(prev, cur)) {
      recordMutation('update', keySlice(prev)!, keySlice(cur)!, id)
    }
  }
  // deletes
  for (const id of Object.keys(beforeMap)) {
    if (!nowMap[id]) {
      recordMutation('delete', keySlice(beforeMap[id])!, undefined, id)
    }
  }

  writeShadow(nowMap)

  if (localStorage.getItem('fc_sync_trace') === '1') {
    console.log('[journalizer] shadow updated. events:', Object.keys(nowMap).length)
  }
}

// ---- boot once ----
(function init() {
  // seed the shadow if missing
  if (!localStorage.getItem(SHADOW_LS)) writeShadow(indexById(readEvents()))

  // run once at load (captures any edits made before this script loaded)
  setTimeout(() => { try { diffAndJournalize() } catch (e) { console.warn('[journalizer] first diff failed', e) } }, 0)

  // run whenever your app announces changes
  window.addEventListener('fc:events-changed', () => {
    try { diffAndJournalize() } catch (e) { console.warn('[journalizer] diff failed', e) }
  })

  // safety: periodic sweep
  setInterval(() => {
    try { diffAndJournalize() } catch {}
  }, 15_000)
})()
