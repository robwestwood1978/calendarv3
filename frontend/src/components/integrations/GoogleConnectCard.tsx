// frontend/src/components/integrations/GoogleConnectCard.tsx
// Connects Google without hardcoding a backend route.
// Emits 'fc:google-oauth-start' so main.tsx can call startGoogleOAuth().
// Keeps enable/disable sync + reset token + developer trace.

import React, { useMemo, useState } from 'react'
import { featureFlags } from '../../state/featureFlags'
import { readSyncConfig, writeSyncConfig, readTokens, writeTokens } from '../../sync/core'

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
const small: React.CSSProperties = { fontSize: 12, opacity: 0.75 }

function useConnected() {
  const [tick, setTick] = useState(0)
  const connected = useMemo(() => {
    try { return !!localStorage.getItem('fc_google_oauth_v1') } catch { return false }
  }, [tick])
  const refresh = () => setTick(t => t + 1)
  return { connected, refresh }
}

export default function GoogleConnectCard() {
  const { connected, refresh } = useConnected()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  function onConnect() {
    setBusy('connect'); setMsg(null)
    try {
      // Let main.tsx decide how to start OAuth (uses your existing google/oauth.ts)
      window.dispatchEvent(new CustomEvent('fc:google-oauth-start', { detail: { redirect: '/settings' } }))
    } catch (e) {
      console.warn(e)
      alert('Could not start Google sign-in.')
    } finally {
      setBusy(null)
    }
  }

  function onDisconnect() {
    if (!confirm('Disconnect Google from Family Calendar?')) return
    setBusy('disconnect'); setMsg(null)
    try {
      localStorage.removeItem('fc_google_oauth_v1') // remove stored token blob
      const cfg = readSyncConfig()
      const next = {
        ...cfg,
        providers: { ...(cfg.providers || {}), google: { enabled: false, calendars: [], accountKey: undefined } },
      }
      writeSyncConfig(next)
      setMsg('Disconnected.')
      refresh()
    } catch (e) {
      console.warn(e)
    } finally {
      setBusy(null)
    }
  }

  function onEnableSync() {
    const cfg = readSyncConfig()
    const next = {
      ...cfg,
      enabled: true,
      providers: {
        ...(cfg.providers || {}),
        google: {
          enabled: true,
          accountKey: cfg.providers?.google?.accountKey || 'default',
          calendars: cfg.providers?.google?.calendars || ['primary'],
        },
      },
      windowWeeks: cfg.windowWeeks || 8,
    }
    writeSyncConfig(next)
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync enabled (Google).' })) } catch {}
  }

  function onDisableSync() {
    const cfg = readSyncConfig()
    const next = {
      ...cfg,
      providers: { ...(cfg.providers || {}), google: { ...(cfg.providers?.google || {}), enabled: false } },
    }
    writeSyncConfig(next)
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync disabled (Google).' })) } catch {}
  }

  function onResetToken() {
    const t = readTokens()
    if (t.google) { t.google.sinceToken = null; writeTokens(t) }
    try { localStorage.removeItem('fc_google_sync_token_v1') } catch {}
    setMsg('Sync token reset. A fresh pull will run on the next cycle.')
  }

  function onToggleTrace(e: React.ChangeEvent<HTMLInputElement>) {
    const on = e.currentTarget.checked
    featureFlags.set({ ...featureFlags.get(), googleTrace: on })
  }

  const traceOn = !!featureFlags.get().googleTrace
  const cfg = readSyncConfig()
  const gEnabled = !!cfg.providers?.google?.enabled
  const appSyncOn = !!cfg.enabled

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={row}>
        <div>
          <div><strong>Status:</strong> {connected ? 'Connected' : 'Not connected'}</div>
          {!connected && <div style={small}>Sign in with Google to enable two-way sync.</div>}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {!connected ? (
            <button onClick={onConnect} disabled={busy==='connect'} className="primary">
              {busy==='connect' ? 'Connecting…' : 'Connect Google'}
            </button>
          ) : (
            <button onClick={onDisconnect} disabled={busy==='disconnect'} style={{ color:'crimson' }}>
              {busy==='disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      </div>

      <div style={row}>
        <div><strong>Sync:</strong> {gEnabled && appSyncOn ? 'Enabled' : 'Disabled'}</div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onEnableSync}>Enable Sync</button>
          <button onClick={onDisableSync}>Disable</button>
          <button onClick={onResetToken}>Reset Google sync</button>
        </div>
      </div>

      <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
        <input type="checkbox" checked={traceOn} onChange={onToggleTrace} />
        <span>Developer trace</span>
      </label>

      {msg && <div style={{ ...small, color:'#2563eb' }}>{msg}</div>}
    </div>
  )
}
