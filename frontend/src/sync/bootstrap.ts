// frontend/src/sync/bootstrap.ts
// Simple scheduler that assembles adapters and runs runSyncOnce on an interval.

import { runSyncOnce, readSyncConfig, type LocalStore } from './core'
import { createGoogleAdapter } from './google'

let _store: LocalStore | null = null
let _timer: number | null = null

export function registerLocalStore(store: LocalStore) {
  _store = store
}

function buildAdapters() {
  const cfg = readSyncConfig()
  const adapters = []
  if (cfg.providers?.google?.enabled) {
    adapters.push(createGoogleAdapter({
      accountKey: cfg.providers.google.accountKey,
      calendars: cfg.providers.google.calendars && cfg.providers.google.calendars.length
        ? cfg.providers.google.calendars
        : ['primary'],
    }))
  }
  // Apple adapter would be built here if/when enabled
  return adapters
}

export function maybeRunSync() {
  const cfg = readSyncConfig()
  if (!cfg.enabled || !_store) return
  const adapters = buildAdapters()
  if (adapters.length === 0) return
  runSyncOnce({ adapters, store: _store })
}

export function startSyncLoop(intervalMs = 30_000) {
  const tick = () => {
    try { maybeRunSync() } catch (e) { console.warn('[sync] run failed:', e) }
  }
  if (_timer != null) clearInterval(_timer as any)
  _timer = setInterval(tick, intervalMs) as any
  // run a first tick quickly
  setTimeout(tick, 800)
}
