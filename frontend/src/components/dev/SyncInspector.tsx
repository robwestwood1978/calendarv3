// frontend/src/components/dev/SyncInspector.tsx
// Lightweight inspector with hotkey + Run Now. Opens with Ctrl/Cmd + Alt + S.
// Also opens via: window.dispatchEvent(new CustomEvent('fc:open-sync-inspector'))

import React from 'react'
import ReactDOM from 'react-dom'

const KEYS = [
  'fc_events_v1','fc_events_v2','fc_events_v3',
  'fc_settings_v1','fc_settings_v2','fc_settings_v3',
  'fc_users_v1','fc_current_user_v1','fc_my_agenda_v1','fc_feature_flags_v1',
  'fc_sync_journal_v1','fc_sync_tokens_v1','fc_sync_diag_v1'
]

function readLS(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function pretty(val: any) {
  if (val == null) return 'null'
  try { return JSON.stringify(JSON.parse(String(val)), null, 2) } catch { return String(val) }
}

export default function SyncInspector() {
  const [open, setOpen] = React.useState(false)
  const [now, setNow] = React.useState<string>(() => new Date().toISOString())
  const [syncing, setSyncing] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)

  React.useEffect(() => {
    const openH = () => setOpen(true)
    window.addEventListener('fc:open-sync-inspector', openH as any)
    return () => window.removeEventListener('fc:open-sync-inspector', openH as any)
  }, [])

  // Hotkey: Ctrl/Cmd + Alt + S
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey
      if (cmd && e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 1000)
    return () => clearInterval(t)
  }, [])

  const runNow = async () => {
    try {
      setSyncing(true); setResult(null)
      const fn = (window as any).__sync_run
      if (typeof fn === 'function') {
        const r = await fn()
        setResult(r ?? { ok: true })
      } else {
        setResult({ ok: false, detail: '__sync_run not available' })
      }
    } catch (e:any) {
      setResult({ ok: false, error: String(e?.message || e) })
    } finally {
      setSyncing(false)
    }
  }

  if (!open) return null

  const wrap: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', zIndex: 9999,
    display: 'grid', placeItems: 'center'
  }
  const panel: React.CSSProperties = { width: 900, maxWidth: '95vw', background: '#0b1220', color: '#e2e8f0', borderRadius: 12, padding: 16, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }
  const pre: React.CSSProperties = { margin: 0, padding: 8, background: '#0b1220', color: '#e2e8f0', borderRadius: 8, maxHeight: 240, overflow: 'auto', fontSize: 12, border: '1px solid #1f2937' }
  const sm: React.CSSProperties = { fontSize: 12, color: '#94a3b8' }

  return ReactDOM.createPortal(
    <div style={wrap} onClick={() => setOpen(false)}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Sync Inspector</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={runNow} disabled={syncing} style={{ padding: '6px 10px', borderRadius: 8 }}>
              {syncing ? 'Running…' : 'Run sync now'}
            </button>
            <button onClick={() => setOpen(false)} style={{ padding: '6px 10px', borderRadius: 8 }}>Close</button>
          </div>
        </div>
        <div style={sm}>Now: {now} · Hotkey: Ctrl/Cmd + Alt + S</div>

        {result ? <div style={{ marginTop: 8, ...sm as any }}>Last run result: {pretty(result)}</div> : null}

        <div style={grid}>
          {KEYS.map(k => {
            const v = readLS(k)
            return (
              <div key={k}>
                <div style={sm}>{k}</div>
                <pre style={pre}>{pretty(v)}</pre>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
