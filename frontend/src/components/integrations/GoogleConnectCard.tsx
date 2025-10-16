// frontend/src/components/integrations/GoogleConnectCard.tsx
// Small, self-contained card that plugs into your existing sync core.
// - No imports from google/oauth.ts — avoids missing export errors.
// - Connect = redirect to your OAuth start route (handled by maybeHandleRedirect on boot).
// - Disconnect = clear stored token + disable Google in sync config.
// - Enable/Disable sync + Reset token + Developer trace toggle.

import React, { useMemo, useState } from 'react'
import { featureFlags } from '../../state/featureFlags'
import { readSyncConfig, writeSyncConfig, readTokens, writeTokens } from '../../sync/core'

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
const small: React.CSSProperties = { fontSize: 12, opacity: 0.75 }

// If your OAuth start path differs, change this to match your backend route.
// Your main.tsx already calls maybeHandleRedirect() on boot and sends users off /oauth2/callback to /settings.
const OAUTH_START_PATH = '/oauth2/start'

function useConnected() {
  const [tick, setTick] = useState(0)
  const connected = useMemo(() => {
    try {
      return !!localStorage.getItem('fc_google_oauth_v1')
    } catch { return false }
  }, [tick])
  const refresh = () => setTick(t => t + 1)
  return { connected, refresh }
}

export default function GoogleConnectCard() {
  const { connected, refresh } = useConnected()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function onConnect() {
    setBusy('connect'); setMsg(null)
    try {
      const url = new URL(OAUTH_START_PATH, window.location.origin)
      url.searchParams.set('provider', 'google')
      // Where to return after /oauth2/callback finishes
      url.searchParams.set('redirect', '/settings')
      window.location.assign(url.toString())
    } catch (e) {
      console.warn(e)
      alert('Could not start Google sign-in.')
    } finally {
      setBusy(null)
    }
  }

  async function onDisconnect() {
    if (!confirm('Disconnect Google from Family Calendar?')) return
    setBusy('disconnect'); setMsg(null)
    try {
      // Best-effort local revoke
      localStorage.removeItem('fc_google_oauth_v1')
      // Explicitly disable Google in sync config
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
    if (t.google) {
      t.google.sinceToken = null
      writeTokens(t)
    }
    // Legacy key, harmless if absent
    try { localStorage.removeItem('fc_google_sync_token_v1') } catch {}
    setMsg('Sync token reset. A fresh windowed pull will run on the next cycle.')
    try { window.dispatchEvent(new Event('fc:sync-trace')) } catch {}
  }

  function onToggleTrace(e: React.ChangeEvent<HTMLInputElement>) {
    const on = e.currentTarget.checked
    const cur = featureFlags.get()
    featureFlags.set({ ...cur, googleTrace: on })
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
