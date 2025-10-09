// frontend/src/components/integrations/GoogleConnectCard.tsx
import React, { useEffect, useState } from 'react'
import { beginAuth, disconnect, isSignedIn, getAccountKey, maybeHandleRedirect } from '../../google/oauth'
import { readSyncConfig, writeSyncConfig } from '../../sync/core'

const row: React.CSSProperties  = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
const small: React.CSSProperties = { fontSize: 12, color: '#64748b' }
const box: React.CSSProperties   = { border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#f8fafc' }

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
    <div style={box}>
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
      <div style={{ marginTop: 6, ...small }}>
        Uses your Google account to read events within your sync window. You can revoke access any time.
      </div>
    </div>
  )
}
