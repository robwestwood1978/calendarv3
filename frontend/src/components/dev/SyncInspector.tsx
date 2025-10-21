import React from 'react'

function read(key: string) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function exists(key: string) {
  try { return localStorage.getItem(key) != null } catch { return false }
}
function dumpAll() {
  const out: Record<string, any> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (!k) continue
    if (!/^fc_/.test(k)) continue
    out[k] = read(k)
  }
  return out
}

export default function SyncInspector() {
  const [open, setOpen] = React.useState(false)
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    const onOpen = () => setOpen(true)
    const onClose = () => setOpen(false)
    window.addEventListener('fc:open-sync-inspector', onOpen as any)
    window.addEventListener('fc:close-sync-inspector', onClose as any)
    return () => {
      window.removeEventListener('fc:open-sync-inspector', onOpen as any)
      window.removeEventListener('fc:close-sync-inspector', onClose as any)
    }
  }, [])

  const cfg = read('fc_sync_cfg_v1') || read('fc_sync_cfg') || {}
  const tokens = read('fc_sync_tokens_v1') || read('fc_sync_tokens') || {}
  const journal = read('fc_sync_journal_v1') || read('fc_sync_journal') || {}
  const oauth = read('fc_google_oauth_v1') || {}

  function clearTokens() {
    try { localStorage.removeItem('fc_sync_tokens_v1'); localStorage.removeItem('fc_sync_tokens') } catch {}
    setTick(t => t + 1)
  }
  function clearJournal() {
    try { localStorage.removeItem('fc_sync_journal_v1'); localStorage.removeItem('fc_sync_journal') } catch {}
    setTick(t => t + 1)
  }

  if (!open) return null

  return (
    <div style={backdrop} onClick={() => setOpen(false)}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={head}>
          <strong>Sync Inspector</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={clearTokens}>Clear tokens</button>
            <button onClick={clearJournal}>Clear journal</button>
            <button onClick={() => setTick(t => t + 1)}>Refresh</button>
            <button onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>

        <div style={sec}>
          <h4>Config</h4>
          <pre style={pre}>{JSON.stringify(cfg, null, 2)}</pre>
        </div>

        <div style={sec}>
          <h4>Tokens</h4>
          <pre style={pre}>{JSON.stringify(tokens, null, 2)}</pre>
        </div>

        <div style={sec}>
          <h4>Journal</h4>
          <pre style={pre}>{JSON.stringify(journal, null, 2)}</pre>
        </div>

        <div style={sec}>
          <h4>Google OAuth</h4>
          <pre style={pre}>{JSON.stringify(oauth, null, 2)}</pre>
        </div>

        <details style={{ marginTop: 10 }}>
          <summary>All fc_* keys</summary>
          <pre style={pre}>{JSON.stringify(dumpAll(), null, 2)}</pre>
        </details>
      </div>
    </div>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center'
}
const panel: React.CSSProperties = {
  width: 'min(90vw, 900px)', maxHeight: '90vh', overflow: 'auto',
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12
}
const head: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 12px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff'
}
const sec: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }
const pre: React.CSSProperties = { margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }
