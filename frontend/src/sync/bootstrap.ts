// frontend/src/sync/bootstrap.ts
// Small, robust bootstrap for the sync engine.
// - Single global loop (no dup timers)
// - Manual "Sync now" via [data-fc-sync-now]
// - Runs on tab-visible and interval ticks
// - Reads providers from sync config and only includes Google when signed in

import { runSyncOnce, readSyncConfig } from './core'
import { getLocalStore } from './localStore'
import { createGoogleAdapter } from './google'
import { isSignedIn } from '../google/oauth'

type LoopState = {
  timerId: number | null
  intervalMs: number
  running: boolean
}

declare global {
  interface Window {
    __fcSyncLoop?: LoopState
  }
}

function toast(msg: string) {
  try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
}

function buildAdapters() {
  const cfg = readSyncConfig()
  const adapters = []

  // Google provider — include only if enabled in config AND user is signed in
  const g = cfg.providers?.google
  if (cfg.enabled && g?.enabled && isSignedIn()) {
    const calendars = Array.isArray(g.calendars) && g.calendars.length ? g.calendars : ['primary']
    adapters.push(createGoogleAdapter({ accountKey: g.accountKey, calendars }))
  }

  // Apple (future): wire here once ready.

  return adapters
}

let _lastSyncStart = 0

export async function maybeRunSync() {
  const cfg = readSyncConfig()
  if (!cfg.enabled) return

  // Prevent overlapping runs
  const now = Date.now()
  if (now - _lastSyncStart < 500) return
  _lastSyncStart = now

  const adapters = buildAdapters()
  if (adapters.length === 0) return

  const store = getLocalStore()

  console.log('[sync] run…', new Date().toISOString())
  try {
    const res = await runSyncOnce({ adapters, store, now: new Date() })
    console.log('[sync] done:', res)
  } catch (err) {
    console.warn('[sync] run failed:', err)
    toast('Sync failed. Open console for details.')
  }
}

/** Start a single shared loop (idempotent). */
export function startSyncLoop(opts?: { intervalMs?: number }) {
  const intervalMs = Math.max(10_000, opts?.intervalMs ?? 60_000) // default 60s
  const state = (window.__fcSyncLoop ||= { timerId: null, intervalMs, running: false })

  // Idempotent: if we’re already running with the same cadence, do nothing
  if (state.timerId && state.intervalMs === intervalMs) return

  // Clear any old loop
  if (state.timerId) {
    clearInterval(state.timerId)
    state.timerId = null
  }
  state.intervalMs = intervalMs

  // Kick a run on visibility gain
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maybeRunSync()
  })

  // Hook the "Sync now" buttons/links
  document.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null
    if (!target) return
    // Match button or its ancestor with the attribute
    const el = target.closest('[data-fc-sync-now]') as HTMLElement | null
    if (el) {
      ev.preventDefault()
      maybeRunSync()
    }
  })

  // Start the timer
  state.timerId = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return
    maybeRunSync()
  }, state.intervalMs)

  // Also tick immediately on start
  setTimeout(() => maybeRunSync(), 0)
}
