import React from 'react'
import { readSyncConfig, writeSyncConfig, readTokens, writeTokens } from '../../sync/core'
import { getAccessToken, clearAccessToken, beginGoogleOAuth } from '../../google/oauth'

export default function GoogleConnectCard() {
  const [connected, setConnected] = React.useState<boolean>(false)
  const [email, setEmail] = React.useState<string | null>(null)
  const [enabled, setEnabled] = React.useState<boolean>(false)
  const [busy, setBusy] = React.useState(false)
  const [trace, setTrace] = React.useState<boolean>(() => !!localStorage.getItem('fc_sync_trace'))

  React.useEffect(() => {
    // read sync enabled
    const cfg = readSyncConfig()
    setEnabled(!!cfg.enabled && !!cfg.providers?.google?.enabled)

    // probe token
    ;(async () => {
      try {
        const token = await getAccessToken()
        if (token) {
          setConnected(true)
          // if your oauth util exposes profile email, set it; otherwise omit
          try {
            const payload = JSON.parse(atob(token.split('.')[1] || 'e30=')) || {}
            setEmail(payload?.email || null)
          } catch {
            setEmail(null)
          }
        } else {
          setConnected(false)
          setEmail(null)
        }
      } catch {
        setConnected(false)
        setEmail(null)
      }
    })()
  }, [])

  function onToggleTrace(e: React.ChangeEvent<HTMLInputElement>) {
    const on = e.currentTarget.checked
    setTrace(on)
    if (on) localStorage.setItem('fc_sync_trace', '1')
    else localStorage.removeItem('fc_sync_trace')
  }

  async function onConnect() {
    setBusy(true)
    try {
      await beginGoogleOAuth() // redirects; if your oauth util is different, it can just set window.location
    } finally {
      setBusy(false)
    }
  }

  async function onDisconnect() {
    if (!confirm('Disconnect Google account?')) return
    setBusy(true)
    try {
      await clearAccessToken()
      setConnected(false)
      setEmail(null)
      // also turn off provider in config
      const cfg = readSyncConfig()
      const next = {
        ...cfg,
        providers: { ...(cfg.providers || {}), google: { enabled: false, calendars: [] } },
        enabled: false ? cfg.enabled && false : cfg.enabled // leave master alone; we only disable the google provider
      }
      writeSyncConfig(next)
    } finally {
      setBusy(false)
    }
  }

  function onEnableSync() {
    const cfg = readSyncConfig()
    const next = {
      ...cfg,
      enabled: true,
      windowWeeks: cfg.windowWeeks || 8,
      providers: {
        ...(cfg.providers || {}),
        google: {
          enabled: true,
          accountKey: cfg.providers?.google?.accountKey || 'primary',
          calendars: cfg.providers?.google?.calendars || ['primary'],
        },
      },
    }
    writeSyncConfig(next)
    setEnabled(true)
    toast('Cloud sync enabled (Google).')
  }

  function onDisableSync() {
    const cfg = readSyncConfig()
    const next = {
      ...cfg,
      providers: { ...(cfg.providers || {}), google: { ...(cfg.providers?.google || {}), enabled: false } },
    }
    writeSyncConfig(next)
    setEnabled(false)
    toast('Cloud sync disabled (Google).')
  }

  function onResetSync() {
    const t = readTokens()
    delete (t as any).google
    writeTokens(t)
    toast('Google sync token reset. Next run will do a full refresh.')
  }

  return (
    <div style={wrap}>
      <div style={row}>
        <div>
          <div style={{ fontWeight: 600 }}>Status: {connected ? 'Connected' : 'Not connected'}</div>
          {connected && email && <div style={{ opacity: .7, fontSize: 12 }}>{email}</div>}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {!connected ? (
            <button onClick={onConnect} disabled={busy}>Connect Google</button>
          ) : (
            <button onClick={onDisconnect} disabled={busy}>Disconnect</button>
          )}
          {connected && (!enabled ? (
            <button onClick={onEnableSync} className="primary" disabled={busy}>Enable Sync</button>
          ) : (
            <button onClick={onDisableSync} disabled={busy}>Disable Sync</button>
          ))}
          <button onClick={onResetSync} disabled={!connected || busy}>Reset Google sync</button>
        </div>
      </div>

      <label style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:8 }}>
        <input type="checkbox" checked={trace} onChange={onToggleTrace} />
        <span>Developer trace</span>
      </label>

      <p style={hint}>
        Two-way sync: edits you make here are pushed to Google; changes in Google are pulled into the app.
        Public ICS (in Integrations) is read-only.
      </p>
    </div>
  )
}

function toast(msg:string){ try{ window.dispatchEvent(new CustomEvent('toast',{detail:msg})) }catch{} }

const wrap: React.CSSProperties = { padding: 12, border: '1px solid #e5e7eb', borderRadius: 12, background:'#fff' }
const row:  React.CSSProperties = { display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }
const hint: React.CSSProperties = { color:'#64748b', fontSize:12, margin:'8px 0 0' }
