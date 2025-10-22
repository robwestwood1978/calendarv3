// frontend/src/sync/diag.ts
// Tiny diagnostics shim used by sync core/google adapter.
// Stores a rolling log in localStorage and optionally logs to console when window.FC_TRACE is true.

type Entry = {
  ts: string
  ch: '[sync]' | '[pull]' | '[push]' | '[google]' | '[journal]' | '[error]'
  data: any
}

const LS_KEY = 'fc_sync_diag_v1'
const MAX = 300

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Entry[]) : []
  } catch { return [] }
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
      // compact console
      console.log(ch, data)
    } catch {}
  }
}

export const diag = {
  log(data: any) { add('[sync]', data) },
  error(data: any) { add('[error]', data) },
  pull(data: any) { add('[pull]', data) },
  push(data: any) { add('[push]', data) },
  google(data: any) { add('[google]', data) },
  journal(data: any) { add('[journal]', data) },
  /** convenience for external readers */
  readAll(): Entry[] { return read() },
  clear() { try { localStorage.removeItem(LS_KEY) } catch {} },
}
