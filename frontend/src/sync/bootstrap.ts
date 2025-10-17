// Small self-contained sync loop (no external runner). Ticks on visibility & interval.

import { runSyncOnce } from './core'
import { createGoogleAdapter } from './google'
import { readSyncConfig } from './core'
import { storeBridge } from './store-bridge'

const TICK_MS = 30_000

let timer: any = null
let lastRun = 0

export function maybeRunSync() {
  const cfg = readSyncConfig()
  if (!cfg?.enabled) return
  run().catch(e => console.warn('[sync] run failed:', e))
}

export function startSyncLoop() {
  stopSyncLoop()
  const onVis = () => { if (document.visibilityState === 'visible') maybeRunSync() }
  document.addEventListener('visibilitychange', onVis)
  timer = setInterval(() => maybeRunSync(), TICK_MS)
  // kick
  maybeRunSync()
}

export function stopSyncLoop() {
  if (timer) clearInterval(timer)
  timer = null
}

async function run() {
  const now = Date.now()
  if (now - lastRun < 2_000) return
  lastRun = now

  const cfg = readSyncConfig()
  if (!cfg?.enabled) return

  const adapters = []
  if (cfg.providers?.google?.enabled) {
    adapters.push(createGoogleAdapter({
      calendars: cfg.providers.google.calendars,
      accountKey: cfg.providers.google.accountKey,
    }))
  }
  if (adapters.length === 0) return

  if (localStorage.getItem('fc_sync_trace') === '1') console.log('[sync] run…', new Date().toISOString())

  const res = await runSyncOnce({
    adapters,
    store: storeBridge,
  })

  if (localStorage.getItem('fc_sync_trace') === '1') console.log('[sync] done:', res)
}
