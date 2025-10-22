// Bootstraps sync: journalizer + run loop + Google adapter wiring.

import { runSyncOnce } from './core'
import { localStore } from './localStore'
import { startJournalizer } from './journalizer'
import { readSyncConfig } from './core'
import { createGoogleAdapter } from './google'

let loopOn = false
let timer: any = null

function buildAdapters() {
  const cfg = readSyncConfig()
  const ads = []
  if (cfg.providers?.google?.enabled) {
    ads.push(createGoogleAdapter({
      accountKey: cfg.providers.google.accountKey || undefined,
      calendars: cfg.providers.google.calendars && cfg.providers.google.calendars.length
        ? cfg.providers.google.calendars
        : ['primary'],
    }))
  }
  // (Apple adapter would be added here later)
  return ads
}

export async function maybeRunSync() {
  const cfg = readSyncConfig()
  if (!cfg.enabled) return
  try {
    console.log('[sync] run…', new Date().toISOString())
    await runSyncOnce({ adapters: buildAdapters(), store: localStore })
    console.log('[sync] done:', { ok: true })
  } catch (e) {
    console.warn('[sync] run failed:', e)
  }
}

export function startSyncLoop(intervalMs = 30_000) {
  if (loopOn) return
  loopOn = true

  // Start the journalizer so we actually get push entries
  startJournalizer()

  // Tick on visibility change (fast catch-up when the tab refocuses)
  const onVis = () => { if (document.visibilityState === 'visible') maybeRunSync() }
  document.addEventListener('visibilitychange', onVis)

  // Initial run + interval
  maybeRunSync()
  timer = setInterval(maybeRunSync, intervalMs)

  // Expose controls for debugging
  ;(window as any).__sync_run = maybeRunSync
  ;(window as any).__sync_stop = () => { clearInterval(timer); loopOn = false }
}
