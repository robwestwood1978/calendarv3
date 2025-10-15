// frontend/src/sync/bootstrap.ts
// 30s polling + visibility-triggered pulls. Small, safe wrapper around core.

import { readSyncConfig } from './core'
import { runSyncOnce } from './core' // core should already expose this in your repo

let timer: number | null = null
const INTERVAL_MS = 30_000

export function maybeRunSync() {
  try {
    const cfg = readSyncConfig()
    if (!cfg?.enabled) return
    // Only run if at least one provider is on
    const anyOn = !!(
      cfg.providers?.google?.enabled ||
      cfg.providers?.apple?.enabled
    )
    if (!anyOn) return
    runSyncOnce().catch((err: any) => {
      console.warn('[sync] run failed:', err)
      // Surface a tiny toast so you notice if it keeps failing
      try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Sync failed (see console)' })) } catch {}
    })
  } catch (e) {
    console.warn('[sync] maybeRunSync error:', e)
  }
}

export function startSyncLoop() {
  // Clear old timers (hot reload / double calls safe)
  if (timer) {
    clearInterval(timer)
    timer = null
  }

  // Regular background tick
  timer = window.setInterval(() => {
    maybeRunSync()
  }, INTERVAL_MS)

  // Pull immediately when you foreground the tab/app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      maybeRunSync()
    }
  })

  // First kick (don’t wait 30s on startup)
  queueMicrotask(() => maybeRunSync())
}
