// frontend/src/sync/bootstrap.ts
// Start/trigger sync with a single-flight lock & light throttle.

import { runSyncOnce, readSyncConfig } from './core'
import { createGoogleAdapter } from './google'
import { getLocalStore } from './localStore' // your existing local store getter

const SYNC_INTERVAL_MS = 5 * 60 * 1000

let started = false
let inFlight = false
let lastKick = 0

async function kick() {
  const now = Date.now()
  if (inFlight) return
  if (now - lastKick < 3000) return // 3s throttle
  lastKick = now

  const cfg = readSyncConfig()
  if (!cfg.enabled) return

  inFlight = true
  try {
    const adapters = []
    if (cfg.providers?.google?.enabled) {
      adapters.push(createGoogleAdapter({
        accountKey: cfg.providers.google.accountKey,
        calendars: cfg.providers.google.calendars,
      }))
    }
    if (adapters.length === 0) return

    console.log('[sync] run…', new Date().toISOString())
    const res = await runSyncOnce({
      adapters,
      store: getLocalStore(),
    })
    console.log('[sync] done:', res)
  } finally {
    inFlight = false
  }
}

export function maybeRunSync() {
  // safe to call anytime
  kick()
}

export function startSyncLoop() {
  if (started) return
  started = true

  // first run
  kick()

  // interval
  setInterval(kick, SYNC_INTERVAL_MS)

  // tab regains focus — try again
  try { window.addEventListener('visibilitychange', () => { if (!document.hidden) kick() }) } catch {}
  try { window.addEventListener('online', () => kick()) } catch {}
}
