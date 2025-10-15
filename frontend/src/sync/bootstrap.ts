// frontend/src/sync/bootstrap.ts
// Sync bootstrap + developer trace toggle (safe mode)

import { readSyncConfig } from './core'

// ---- Developer trace toggle (simple localStorage flag) ----
const TRACE_KEY = 'fc_sync_trace_v1'

export function isTraceEnabled(): boolean {
  try { return localStorage.getItem(TRACE_KEY) === '1' } catch { return false }
}

export function setTraceEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(TRACE_KEY, '1')
    else localStorage.removeItem(TRACE_KEY)
    // Bubble a small toast if the host listens for it
    try {
      const msg = on ? 'Developer trace: ON' : 'Developer trace: OFF'
      window.dispatchEvent(new CustomEvent('toast', { detail: msg }))
    } catch {}
  } catch {}
}

function tlog(...args: any[]) {
  if (!isTraceEnabled()) return
  // Console + custom event hook (for any side panel loggers)
  // Keep it super safe—never throw from here.
  try { console.debug('[sync]', ...args) } catch {}
  try { window.dispatchEvent(new CustomEvent('fc:sync-trace', { detail: args })) } catch {}
}

// ---- Simple guard so we don’t start two intervals
let started = false
let timer: number | null = null

// Public getter so UI can show “last sync”
let _lastSyncISO: string | null = null
export function getLastSyncISO() { return _lastSyncISO }

// One-shot sync runner. This deliberately keeps behaviour minimal/safe.
// Your actual provider work happens elsewhere (pull happens on a timer,
// push happens on-save from your agenda code).
export async function maybeRunSync() {
  try {
    const cfg = readSyncConfig()
    if (!cfg?.enabled) {
      tlog('skip: sync disabled')
      return
    }
    tlog('sync tick: windowWeeks=%o providers=%o', cfg.windowWeeks, Object.keys(cfg.providers || {}))
    // The project’s Slice-D design does pull on timer and push on save.
    // If you later add an explicit pull call here, keep it try/catch:
    _lastSyncISO = new Date().toISOString()
    // Emit a gentle “changed” pulse so UI can react
    try { window.dispatchEvent(new Event('fc:events-changed')) } catch {}
  } catch (e) {
    tlog('sync tick failed:', e)
  }
}

export function startSyncLoop(intervalMs = 5 * 60 * 1000) {
  if (started) return
  started = true

  // Run at tab visibility changes too—cheap and keeps things feeling “fresh”
  const onVisible = () => {
    try {
      if (document.visibilityState === 'visible') maybeRunSync()
    } catch {}
  }
  try { document.addEventListener('visibilitychange', onVisible) } catch {}

  // Kick once now…
  maybeRunSync()

  // …then every N minutes
  timer = window.setInterval(() => {
    maybeRunSync()
  }, intervalMs) as unknown as number

  tlog('sync loop started (every %sms)', intervalMs)
}

// Optional: allows the Calendar toolbar to trigger a manual tick.
// Safe no-op if sync is disabled.
export async function runManualSync() {
  tlog('manual sync requested')
  await maybeRunSync()
  try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Sync complete.' })) } catch {}
}
