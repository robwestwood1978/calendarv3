// frontend/src/components/dev/SyncInspector.tsx
// Lightweight diagnostics panel. Opens via keyboard (Ctrl/Cmd+Alt+S) or window event.

import React from 'react'

type SyncLog = {
  at: string
  phase: 'run' | 'pull' | 'push' | 'done' | 'error'
  note?: string
  data?: any
}

const LS_KEY = 'fc_sync_diag_v1'

function readLog(): SyncLog[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function writeLog(rows: SyncLog[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rows.slice(-200))) } catch {}
}

export function appendDiag(entry: SyncLog) {
  const rows = readLog()
  rows.push(entry)
  writeLog(rows)
  try { window.dispatchEvent(new CustomEvent('fc:sync-diag-updated')) } catch {}
}

// global hotkey and quick floating button (only when ?trace=1)
(function bootstrapOnce() {
  if ((window as any).__SYNC_INSPECTOR_WIRED__) return
  ;(window as any).__SYNC_INSPECTOR_WIRED__ = true

  window.addEventListener('keydown', (e) => {
    try {
      if (!((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 's')) return
      window.dispatchEvent(new CustomEvent('fc:open-sync-inspector'))
    } catch {}
  })

  try {
    const url = new URL(location.href)
    if (url.searchParams.get('trace') !== '1') return
    const btn = document.createElement('button')
    btn.textContent = 'Sync Inspector'
    Object.assign(btn.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: '9999',
      padding: '8px 10px', borderRadius: '10px', border: '1px solid #e5e7eb',
      background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.1)', cursor: 'pointer'
    })
    btn.onclick = () => window.dispatchEvent(new CustomEvent('fc:open-sync-inspector'))
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn))
  } catch {}
})()

export default function SyncInspector() {
  const [open, setOpen] = React.useState(false)
  const [rows, setRows] = React.useState<SyncLog[]>(() => readLog())

  React.useEffect(() => {
    const onOpen = () => setOpen(true)
    const onUpd = () => setRows(readLog())
    window.addEventListener('fc:open-sync-inspector', onOpen)
    window.addEventListener('fc:sync-diag-updated', onUpd)
    return () => {
      window.removeEventListener('fc:open-sync-inspector', onOpen)
      window.removeEventListener('fc:sync-diag-updated', onUpd)
    }
  }, [])

  if (!open) return null

  function clear() {
    writeLog([])
    setRows([])
  }

  function syncNow() {
    try { window.dispatchEvent(new CustomEvent('fc:sync-now')) } catch {}
  }

  return (
    <div style={backdrop} onClick={() => setOpen(false)}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={head}>
          <strong>Sync Inspector</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={syncNow}>Sync now</button>
            <button onClick={clear}>Clear</button>
            <button onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
        <div style={body}>
          {rows.length === 0 && <div style={{ opacity: .7 }}>No diagnostics yet.</div>}
          {rows.slice().reverse().map((r, i) => (
            <div key={i} style={{ borderBottom: '1px solid #e5e7eb', padding: '6px 0' }}>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>
                <span style={{ opacity: .7 }}>{r.at}</span> · <b>{r.phase}</b> {r.note ? `— ${r.note}` : ''}
              </div>
              {r.data ? (
                <pre style={{ margin: 0, fontSize: 12, overflowX: 'auto' }}>
{JSON.stringify(r.data, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
}
const panel: React.CSSProperties = {
  width: 780, maxWidth: '95%', maxHeight: '90vh', background: '#fff',
  borderRadius: 12, border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column'
}
const head: React.CSSProperties = {
  padding: '10px 12px', display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', borderBottom: '1px solid #e5e7eb'
}
const body: React.CSSProperties = { padding: 12, overflow: 'auto' }
