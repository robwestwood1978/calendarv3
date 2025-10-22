// frontend/src/sync/bootstrap.ts
// PATCH v3.1 — Sync bootstrap/loop + “Sync now” wiring.
// - Safe interval loop (single-flight guarded via runner.ts)
// - Visibility tick (nudge when tab becomes active)
// - Global event + DOM hook for your Sync button(s)
// - No-ops cleanly when sync is disabled

import { readSyncConfig } from './core'
import { runSyncOnce, isRunning, lastRunAt } from './runner'

const PERIOD_MS = 30_000 // how often to try a run (30s). Adjust if you like.

let loopId: number | null = null
let wiredDom = false

function toast(msg: string) {
  try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
}

/** Try a sync run if enabled and not already running */
async function maybeTick() {
  const cfg = readSyncConfig()
  if (!cfg?.enabled) return
  if (isRunning()) return
  await runSyncOnce()
}

/** DOM wiring: any element with [data-fc-sync-now] will trigger a run */
function wireDomSyncButton() {
  if (wiredDom) return
  wiredDom = true
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null
    if (!t) return
    const btn = t.closest('[data-fc-sync-now]') as HTMLElement | null
    if (!btn) return
    e.preventDefault()
    e.stopPropagation()
    // Dispatch the same custom event runner listens for
    window.dispatchEvent(new CustomEvent('fc:sync-now'))
    toast('Syncing…')
  })
}

/** Public: start the background loop + hooks */
export function startSyncLoop() {
  const cfg = readSyncConfig()
  if (!cfg?.enabled) {
    // If loop is running but sync is now disabled, stop it
    if (loopId != null) {
      clearInterval(loopId)
      loopId = null
    }
    return
  }

  // Wire one-time helpers
  wireDomSyncButton()

  // Interval loop
  if (loopId == null) {
    loopId = window.setInterval(() => { void maybeTick() }, PERIOD_MS)
  }

  // Nudge when the tab becomes visible (and we haven’t run very recently)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    const last = lastRunAt()
    if (!last) { void maybeTick(); return }
    try {
      const ago = Date.now() - new Date(last).getTime()
      if (ago > 60_000 && !isRunning()) void maybeTick()
    } catch {
      void maybeTick()
    }
  })

  // Expose manual trigger for debugging
  ;(window as any).FC_syncNow = async () => {
    toast('Syncing…')
    await runSyncOnce()
  }
}

/** Public: try a one-off sync at boot (safe if disabled) */
export function maybeRunSync() {
  const cfg = readSyncConfig()
  if (!cfg?.enabled) return
  void maybeTick()
}
