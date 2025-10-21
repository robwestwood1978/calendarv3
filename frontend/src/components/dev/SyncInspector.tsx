// frontend/src/components/dev/SyncInspector.tsx
// Lightweight inspector: reads from localStorage keys and shows current state.
// Opens via: window.dispatchEvent(new CustomEvent('fc:open-sync-inspector'))

import React from 'react'
import ReactDOM from 'react-dom'

const KEYS = [
  'fc_events_v1',
  'fc_settings_v1',
  'fc_settings_v2',
  'fc_settings_v3',
  'fc_users_v1',
  'fc_current_user_v1',
  'fc_my_agenda_v1',
  'fc_feature_flags_v1',
  'fc_google_oauth_v1',
  // sync-specific:
  'fc_sync_cfg',
  'fc_sync_tokens',
  'fc_sync_journal',
  'fc_sync_shadow',
]

function read(key: string) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}

export default function SyncInspector() {
  const [open, setOpen] = React.useState(false)
  const [now, setNow] = React.useState<string>(() => new Date().toISOString())

  React.useEffect(() => {
    const openH = () => setOpen(true)
    window.addEventListener('fc:open-sync-inspector', openH as any)
    return () => window.removeEventListener('fc:open-sync-inspector', openH as any)
  }, [])

  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff' }}
      >
        Open Sync Inspector
      </button>
    )
  }

  const content = (
    <div style={wrap}>
      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Sync Inspector</h3>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Now: {now}</div>

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          {KEYS.map(k => {
            const val = read(k)
            const text = val == null ? 'null' : JSON.stringify(val, null, 2)
            return (
              <div key={k}>
                <div style={{ fontWeight: 600 }}>{k}</div>
                <pre style={pre}>{text}</pre>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  // inline render (no portal) to keep simple & portable
  return content
}

const wrap: React.CSSProperties = {
  padding: 12,
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#fff',
}

const panel: React.CSSProperties = { display: 'grid', gap: 8 }

const pre: React.CSSProperties = {
  margin: '6px 0 0 0',
  padding: 8,
  background: '#0b1220',
  color: '#e2e8f0',
  borderRadius: 8,
  maxHeight: 240,
  overflow: 'auto',
  fontSize: 12,
}
