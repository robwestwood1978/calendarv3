// frontend/src/components/integrations/GoogleConnectCard.tsx
import React, { useEffect, useState } from 'react'
import { featureFlags } from '../../state/featureFlags'
import { beginAuth, disconnect, isSignedIn, getAccountKey, maybeHandleRedirect } from '../../google/oauth'
import { readSyncConfig, writeSyncConfig } from '../../sync/core'

const card: React.CSSProperties = { padding: 12, background: 'var(--card-bg, #fff)', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }
const row: React.CSSProperties  = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
const small: React.CSSProperties = { fontSize: 12, opacity: 0.75 }

function toast(msg: string) { try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {} }

export default function GoogleConnectCard() {
  const [authed, setAuthed] = useState<boolean>(isSignedIn())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // If user has just returned from OAuth, this will finalise tokens and show a toast.
    maybeHandleRedirect().then((handled) => { if (handled) setAuthed(isSignedIn()) }).catch((e) => console.warn(e))
  }, [])

  const onConnect = async () => {
    setBusy(true)
    try {
      await beginAuth(['https://www.googleapis.com/auth/calendar'])
    } catch (e: any) {
      alert(e?.message || 'Could not start Google sign-in')
      setBusy(false)
    }
  }

  const onDisconnect = () => {
    disconnect()
    const cfg = readSyncConfig()
    const next = { ...cfg, providers: { ...(cfg.providers||{}), google: { ...(cfg.providers?.google||{}), enabled: false, accountKey: undefined } } }
    writeSyncConfig(next as any)
    setAuthed(false)
    toast('Google disconnected')
  }

  const onEnableSync = () => {
    const cfg = readSyncConfig()
    const next = {
      ...cfg,
      enabled: true,
      providers: {
        ...(cfg.providers || {}),
        google: {
          enabled: true,
          accountKey: getAccountKey() || 'google-default',
          calendars: ['primary'],
        },
        apple: { ...(cfg.providers?.apple || { enabled: false }) },
      },
      windowWeeks: cfg.windowWeeks || 8,
    }
    writeSyncConfig(next as any)
    toast('Cloud sync enabled')
  }

  return (
    <div style={card}>
      <div style={row}>
        <div>
          <div style={{ fontWeight: 600 }}>Google Calendar</div>
          <div style={small}>{authed ? 'Connected' : 'Not connected'}</div>
        </div>
        {!authed ? (
          <button onClick={onConnect} disabled={busy} className="btn">
            {busy ? 'Opening…' : 'Connect'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onEnableSync} className="btn">Enable Sync</button>
            <button onClick={onDisconnect} className="btn btn-secondary">Disconnect</button>
          </div>
        )}
      </div>
      {!featureFlags.get().google && (
        <div style={{ marginTop: 8, ...small }}>
          Tip: set <code>featureFlags.set({'{'} google: true {'}'})</code> in the console to reveal this card.
        </div>
      )}
    </div>
  )
}
