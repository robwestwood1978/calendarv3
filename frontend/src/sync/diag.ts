// frontend/src/sync/diag.ts
// Lightweight diagnostics for pull/reconcile/push. No app logic — logging only.

export type DiagEntry = {
  ts: string               // ISO timestamp
  phase: 'pull'|'reconcile'|'journal'|'push'|'error'|'note'
  provider?: 'google'|'apple'|'ics'
  kind: string             // e.g. 'pull.upsert', 'push.create', 'push.update', 'pull.delete'
  msg?: string
  // Correlation keys
  localId?: string
  externalId?: string
  calendarId?: string
  action?: 'create'|'update'|'delete'
  etag?: string
  // Snapshots (trimmed)
  before?: any
  after?: any
  body?: any
  result?: any
}

type DiagState = {
  max: number
  buf: DiagEntry[]
  ptr: number
  enabled: boolean
}

const LS_KEY = 'fc_diag_enabled_v1'

// Singleton buffer
const st: DiagState = {
  max: 1000,
  buf: [],
  ptr: 0,
  enabled: ((): boolean => {
    try {
      const q = new URL(location.href).searchParams
      if (q.get('trace') === '1') return true
      const on = localStorage.getItem(LS_KEY)
      return on === '1'
    } catch { return false }
  })(),
}

function nowISO() { return new Date().toISOString() }

function push(e: DiagEntry) {
  if (!st.enabled) return
  if (st.buf.length < st.max) {
    st.buf.push(e)
  } else {
    st.buf[st.ptr] = e
    st.ptr = (st.ptr + 1) % st.max
  }
}

export function setDiagEnabled(on: boolean) {
  st.enabled = on
  try { localStorage.setItem(LS_KEY, on ? '1' : '0') } catch {}
}

export function isDiagEnabled() { return st.enabled }

export const diag = {
  enable() { setDiagEnabled(true) },
  disable() { setDiagEnabled(false) },
  log(entry: Omit<DiagEntry,'ts'>) {
    push({ ts: nowISO(), ...entry })
  },
  // Convenience shorthands
  pullUpsert(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'pull', kind: 'pull.upsert', ...p })
  },
  pullDelete(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'pull', kind: 'pull.delete', ...p })
  },
  reconcile(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'reconcile', kind: 'reconcile.upsert', ...p })
  },
  journal(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'journal', kind: 'journal.intent', ...p })
  },
  pushCreate(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'push', kind: 'push.create', action: 'create', ...p })
  },
  pushUpdate(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'push', kind: 'push.update', action: 'update', ...p })
  },
  pushDelete(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'push', kind: 'push.delete', action: 'delete', ...p })
  },
  pushResult(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'push', kind: 'push.result', ...p })
  },
  error(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'error', kind: 'error', ...p })
  },
  note(p: Partial<DiagEntry>) {
    push({ ts: nowISO(), phase: 'note', kind: 'note', ...p })
  },
  dump(): DiagEntry[] {
    // return in chronological order
    if (st.buf.length < st.max && st.ptr === 0) return st.buf.slice()
    // ring wrapped — reconstruct
    const a = st.buf.slice(st.ptr)
    const b = st.buf.slice(0, st.ptr)
    return a.concat(b)
  },
  find(token: string) {
    token = (token || '').toLowerCase()
    const rows = diag.dump()
    return rows.filter(r =>
      (r.localId && r.localId.toLowerCase().includes(token)) ||
      (r.externalId && r.externalId.toLowerCase().includes(token)) ||
      (r.msg && r.msg.toLowerCase().includes(token)) ||
      (r.kind && r.kind.toLowerCase().includes(token))
    )
  },
}

// Minimal global helpers for the console
declare global {
  interface Window { FC_DIAG?: any }
}
export function installGlobalDiag() {
  (window as any).FC_DIAG = {
    enable: () => diag.enable(),
    disable: () => diag.disable(),
    dump: () => diag.dump(),
    find: (q: string) => diag.find(q),
    on: () => setDiagEnabled(true),
    off: () => setDiagEnabled(false),
    get enabled() { return isDiagEnabled() },
  }
}
