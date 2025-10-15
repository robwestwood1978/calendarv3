// frontend/src/sync/bootstrap.ts
// Safe sync bootstrap: periodic pull + manual trigger; no external "e.now" usage.

import { readSyncConfig } from './core'
import { runSyncOnce } from './runner'  // your existing single-shot sync executor

const TICK_MS = 30_000

let intervalId: number | null = null
let running = false

function nowMs() {
  try { return performance.now() } catch { return Date.now() }
}

async function tick(label: string) {
  if (running) return
  running = true
  const t0 = nowMs()
  try {
    const cfg = readSyncConfig()
    if (!cfg?.enabled) return

    // defensive: only pass configured providers
    await runSyncOnce({ cfg })
  } catch (err) {
    // swallow — runner already logs; avoid breaking the loop
    try { console.warn('[sync] run failed:', err) } catch {}
  } finally {
    running = false
    const dt = Math.round(nowMs() - t0)
    try { window.dispatchEvent(new CustomEvent('fc:sync-trace', { detail: `tick ${label} in ${dt}ms` })) } catch {}
  }
}

export function maybeRunSync() {
  // If sync is enabled and we haven’t started yet, run once immediately.
  const cfg = readSyncConfig()
  if (!cfg?.enabled) return
  void tick('bootstrap')
}

export function startSyncLoop() {
  const cfg = readSyncConfig()
  if (!cfg?.enabled) {
    // ensure any previous loop is stopped
    if (intervalId != null) { clearInterval(intervalId); intervalId = null }
    return
  }

  if (intervalId != null) return // already running

  intervalId = window.setInterval(() => {
    void tick('interval')
  }, TICK_MS)

  // Manual trigger (e.g. after resetting token)
  window.addEventListener('fc:sync-now', () => void tick('manual'))
  // Visibility wake-up (optional)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick('visible')
  })
}
