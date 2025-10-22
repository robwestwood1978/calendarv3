// frontend/src/sync/diag.ts
// Tiny diagnostics shim used by the sync core and adapters.
// Persists a rolling log to localStorage and (optionally) mirrors to console
// when `window.FC_TRACE = true`.
//
// Provided channels:
//   log      → [sync]   general notes / lifecycle
//   error    → [error]  errors
//   pull     → [pull]   pull-related entries
//   push     → [push]   push-related entries (generic)
//   pushResult → [push] structured per-intent results from core.ts
//   google   → [google] adapter-specific lines
//   journal  → [journal] journal actions
//
// Storage key: fc_sync_diag_v1

type Entry = {
  ts: string
  ch: '[sync]' | '[pull]' | '[push]' | '[google]' | '[journal]' | '[error]'
  data: any
}

const LS_KEY = 'fc_sync_diag_v1'
const MAX = 500

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Entry[]) : []
  } catch {
    return []
  }
}

function write(list: Entry[]) {
  try {
    if (list.length > MAX) list = list.slice(list.length - MAX)
    localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch {}
}

function add(ch: Entry['ch'], data: any) {
  const e: Entry = { ts: new Date().toISOString(), ch, data }
  const list = read()
  list.push(e)
  write(list)
  if ((window as any).FC_TRACE) {
    try {
      // compact console formatting
      // eslint-disable-next-line no-console
      console.log(ch, data)
    } catch {}
  }
}

export const diag = {
  // lifecycle / notes
  log(data: any) { add('[sync]', data) },

  // errors
  error(data: any) { add('[error]', data) },

  // pull events
  pull(data: any) { add('[pull]', data) },

  // push (generic)
  push(data: any) { add('[push]', data) },

  // push (per-intent structured result) — used by core.ts
  pushResult(data: {
    provider?: string
    action?: string
    localId?: string
    externalId?: string
    calendarId?: string
    etag?: string
    result?: any
  }) {
    add('[push]', { kind: 'result', ...data })
  },

  // adapter-specific
  google(data: any) { add('[google]', data) },

  // journal actions
  journal(data: any) { add('[journal]', data) },

  // utilities
  readAll(): Entry[] { return read() },
  clear() { try { localStorage.removeItem(LS_KEY) } catch {} },
}

export type { Entry }
