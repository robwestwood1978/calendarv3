// frontend/src/components/integrations/GoogleConnectCard.tsx
// Small, self-contained Google connect UI that uses YOUR oauth.ts API.
// - Shows Connect / Disconnect
// - Optional "Reset Google sync" (clears stale sync tokens)
// - Toggle for developer trace (simple localStorage flag)
// - Updates SyncConfig.google.enabled so the engine can run when connected

import React from 'react'
import { beginAuth, isSignedIn, disconnect as gDisconnect, getAccountKey } from '../../google/oauth'
import { readSyncConfig, writeSyncConfig, readTokens, writeTokens } from '../../sync/core'

// local storage keys we touch here (kept tiny + explicit)
const TRACE_KEY = 'fc_sync_trace'                   // '1' or removed
const G_SYNC_TOKEN_KEY = 'fc_google_sync_token_v1'  // your earlier token
const SYNC_TOKENS = 'fc_sync_tokens_v1'             // global provider tokens map

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
}
const hint: React.CSSProperties = { color: '#64748b', fontSize: 12 }

export default function GoogleConnectCard() {
  const [connected, setConnected] = React.useState<boolean>(() => isSignedIn())
  const [trace, setTrace] = React.useState<boolean>(() => {
    try { return localStorage.getItem(TRACE_KEY) === '1' } catch { return false }
  })

  // keep SyncConfig.google.enabled in step with auth
  React.useEffect(() => {
    try {
      const cfg = readSyncConfig()
      const nowConnected = isSignedIn()
      const next = {
        ...cfg,
        enabled: cfg.enabled || nowConnected, // don’t disable if user has it on
        providers: {
          ...(cfg.providers || {}),
          google: {
            enabled: nowConnected,
            accountKey: getAccountKey() || cfg.providers?.google?.accountKey || 'google-default',
            calendars: cfg.providers?.google?.calendars || ['primary'],
          },
          apple: cfg.providers?.apple || { enabled: false },
        },
      }
      writeSyncConfig(next)
    } catch {}
  }, [connected])

  const onConnect = () => {
    // This will redirect to Google, then back to /oauth2/callback where your
    // existing maybeHandleRedirect() stores tokens and navigates to /settings.
    try {
      beginAuth(['https://www.googleapis.com/auth/calendar'])
    } catch (e) {
      alert(String(e))
    }
  }

  const onDisconnect = () => {
    try {
      gDisconnect()                     // drop access/refresh tokens
      localStorage.removeItem(G_SYNC_TOKEN_KEY)
      localStorage.removeItem(SYNC_TOKENS)
      // also clear sync core’s token map if your core writes there:
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        writeTokens({} as any) // harmless reset
      } catch {}
      setConnected(false)
      toast('Google disconnected.')
    } catch (e) {
      alert(String(e))
    }
  }

  const onResetSync = () => {
    try {
      localStorage.removeItem(G_SYNC_TOKEN_KEY)
      localStorage.removeItem(SYNC_TOKENS)
      toast('Google sync reset. A fresh pull will run on the next sync tick.')
    } catch {}
  }

  const onToggleTrace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const on = e.currentTarget.checked
    setTrace(on)
    try {
      if (on) localStorage.setItem(TRACE_KEY, '1')
      else localStorage.removeItem(TRACE_KEY)
    } catch {}
  }

  // tiny helper
  function toast(msg: string) {
    try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={row}>
        <div><strong>Google Calendar</strong></div>
        {connected ? (
          <button onClick={onDisconnect}>Disconnect</button>
        ) : (
          <button className="primary" onClick={onConnect}>Connect Google</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div>Status: <strong>{connected ? 'Connected' : 'Not connected'}</strong></div>
        {connected && <button onClick={onResetSync}>Reset Google sync</button>}
      </div>

      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={trace} onChange={onToggleTrace} />
        <span>Developer trace</span>
      </label>

      <p style={hint}>
        If you ever see <code>syncTokenWithNonDefaultOrdering</code> or stale data, press “Reset Google sync” to force a fresh window pull.
      </p>
    </div>
  )
}
