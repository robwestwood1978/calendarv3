// frontend/src/sync/bootstrap.ts
// Starts a small sync loop and exposes a manual kicker. Pulls & pushes.
// Ticks on: page load, every 30s, tab re-focus, and when your data changes.

import { runOnce } from './runner'

let timer: number | null = null
let inFlight = false

function traceOn() {
  try { return localStorage.getItem('fc_sync_trace') === '1' } catch { return false }
}

async function tick(label: string) {
  if (inFlight) return
  inFlight = true
  try {
    if (traceOn()) console.debug('[sync] tick →', label)
    const res = await runOnce()
    if (traceOn()) console.debug('[sync] result:', res)
    // Nudge the UI to refresh if anything landed
    try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
  } catch (e) {
    console.warn('[sync] run failed:', e)
  } finally {
    inFlight = false
  }
}

export function maybeRunSync() {
  // one eager pass on boot
  tick('boot')
}

export function startSyncLoop() {
  stopSyncLoop()
  // steady state every 30s (you can relax this later)
  timer = window.setInterval(() => tick('interval'), 30_000)

  // run when tab becomes visible
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick('visible')
    })
  } catch {}

  // run when your local store emits changes
  try {
    window.addEventListener('fc:events-changed', () => tick('events-changed'))
  } catch {}

  if (traceOn()) console.debug('[sync] loop started')
}

export function stopSyncLoop() {
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}
