// frontend/src/sync/bootstrap.ts
// Bootstraps sync: journalizer + run loop + Google adapter wiring.

import { runSyncOnce, readSyncConfig } from './core'
import { localStore } from './localStore'
import { startJournalizer } from './journalizer'
import { createGoogleAdapter } from './google'

let loopOn = false
let timer: any = null

function buildAdapters() {
  const cfg = readSyncConfig()
  const ads: any[] = []
  if (cfg.providers?.google?.enabled) {
    ads.push(createGoogleAdapter({
      calendars: cfg.providers.google.calendars || ['primary'],
    }))
  }
  return ads
}

async function maybeRunSync() {
  if (!loopOn) return
  const adapters = buildAdapters()
  if (adapters.length === 0) return
  try {
    const res = await runSyncOnce({ adapters, store: localStore, now: new Date() })
    if ((window as any).FC_TRACE) {
      try { console.log('[sync] result', res) } catch {}
    }
  } catch (e) {
    console.warn('[sync] run failed:', e)
  }
}

export function startSyncLoop(intervalMs = 30_000) {
  if (loopOn) return
  loopOn = true

  startJournalizer()

  // URL toggle: ?sync=on / ?sync=off
  try {
    const q = new URL(location.href).searchParams
    const sv = q.get('sync')
    if (sv === 'off') loopOn = false
    if (sv === 'on') loopOn = true
  } catch {}

  // Visibility tick
  const onVis = () => { if (document.visibilityState === 'visible') maybeRunSync() }
  document.addEventListener('visibilitychange', onVis)

  // Initial run + interval
  if (loopOn) {
    maybeRunSync()
    timer = setInterval(maybeRunSync, intervalMs)
  }

  // Expose controls for debugging
  ;(window as any).__sync_run = async () => { await runSyncOnce({ adapters: buildAdapters(), store: localStore, now: new Date() }) }
  ;(window as any).__sync_stop = () => { try { clearInterval(timer) } catch {}; loopOn = false }
  ;(window as any).__sync_start = () => { if (!loopOn) { loopOn = true; maybeRunSync(); timer = setInterval(maybeRunSync, intervalMs) } }

  // Helper to open Inspector with the hotkey
  ;(window as any).FC_TRACE = !!(window as any).FC_TRACE
  document.addEventListener('keydown', (e: any) => {
    const cmd = e.metaKey || e.ctrlKey
    if (cmd && e.altKey && (e.key === 's' || e.key === 'S')) {
      try { window.dispatchEvent(new CustomEvent('fc:open-sync-inspector')) } catch {}
    }
  })
}
