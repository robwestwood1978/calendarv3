// frontend/src/sync/bootstrap.ts
// Safe sync bootstrap: periodic pull + manual trigger; no external "e.now" usage.

import { readSyncConfig, runSyncOnce } from './core'

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

    // Single-shot sync; core handles providers + tokens.
    await runSyncOnce({ cfg })
  } catch (err) {
    // Keep the loop alive; core/adapter code should already log details.
    try { console.warn('[sync] run failed:', err) } catch {}
  } finally {
    running = false
    const dt = Math.round(nowMs() - t0)
    try { window.dispatchEvent(new CustomEvent('fc:sync-trace', { detail: `tick ${label} in ${dt}ms` })) } catch {}
  }
}

/** Kick a one-off sync if enabled. */
export function maybeRunSync() {
  const cfg = readSyncConfig()
  if (!cfg?.enabled) return
  void tick('bootstrap')
}

/** Start the periodic loop; idempotent. */
export function startSyncLoop() {
  const cfg = readSyncConfig()
  if (!cfg?.enabled) {
    if (intervalId != null) { clearInterval(intervalId); intervalId = null }
    return
  }

  if (intervalId != null) return // already running

  intervalId = window.setInterval(() => { void tick('interval') }, TICK_MS)

  // Manual trigger (e.g. after resetting tokens from Settings)
  window.addEventListener('fc:sync-now', () => { void tick('manual') })

  // Wake sync when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick('visible')
  })
}
