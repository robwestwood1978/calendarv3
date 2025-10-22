// frontend/src/components/integrations/GoogleConnectCard.tsx
// Minimal Google connect card. Uses your oauth.ts (beginAuth/getAccessToken/disconnect).

import React from 'react'
import { beginAuth, getAccessToken, disconnect, isSignedIn, getAccountKey } from '../../google/oauth'
import { readSyncConfig, writeSyncConfig, readTokens, writeTokens } from '../../sync/core'

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
const small: React.CSSProperties = { fontSize: 12, opacity: 0.75 }

function useGoogleStatus() {
  const [ok, setOk] = React.useState<boolean>(() => isSignedIn())
  const [hint, setHint] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const t = await getAccessToken()
      setOk(!!t)
      setHint(null)
    } catch (e: any) {
      setOk(false)
      setHint(String(e?.message || e))
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  return { ok, hint, refresh }
}

export default function GoogleConnectCard() {
  const { ok, hint, refresh } = useGoogleStatus()

  async function onConnect() {
    try {
      await beginAuth(['https://www.googleapis.com/auth/calendar'])
      // browser navigates → on return maybeHandleRedirect() fires and Settings reloads
    } catch (e) {
      console.warn('beginAuth failed', e)
      alert('Could not start Google sign-in.')
    }
  }

  function onDisconnect() {
    try { disconnect() } catch {}
    // also disable provider in sync config
    const cfg = readSyncConfig()
    const next = {
      ...cfg,
      providers: {
        ...cfg.providers,
        google: { ...(cfg.providers?.google || {}), enabled: false },
      },
    }
    writeSyncConfig(next)
    writeTokens({ ...readTokens(), google: { sinceToken: null } }) // drop google sync token
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Google disconnected.' })) } catch {}
    refresh()
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
          accountKey: getAccountKey() || 'google-default',
          calendars: cfg.providers?.google?.calendars?.length ? cfg.providers!.google!.calendars! : ['primary'],
        },
        apple: cfg.providers?.apple || { enabled: false },
      },
      windowWeeks: cfg.windowWeeks || 8,
    }
    writeSyncConfig(next)
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync enabled (Google).' })) } catch {}
  }

  return (
    <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <strong>Google Calendar</strong>
          <div style={small}>{ok ? 'Connected' : 'Not connected'}</div>
          {hint && <div style={{ ...small, color: '#b45309', whiteSpace: 'pre-wrap' }}>{hint}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!ok ? (
            <button onClick={onConnect}>Connect</button>
          ) : (
            <>
              <button onClick={onEnableSync}>Enable Sync</button>
              <button onClick={onDisconnect} style={{ color: 'crimson' }}>Disconnect</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
