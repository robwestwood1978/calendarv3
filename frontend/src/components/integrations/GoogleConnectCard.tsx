// frontend/src/components/integrations/GoogleConnectCard.tsx
// Minimal, robust Google connect card.
// - Uses your existing oauth.ts exports (beginAuth / isSignedIn / getAccessToken / disconnect).
// - Writes to sync config so the runner sees Google as enabled.
// - Exposes a "Sync now" button via [data-fc-sync-now] that the bootstrap listener picks up.
// - No assumptions about server routes.

import React from 'react'
import { readSyncConfig, writeSyncConfig } from '../../sync/core'
import { beginAuth, isSignedIn, getAccessToken, disconnect as oauthDisconnect } from '../../google/oauth'

type Status = 'unknown' | 'disconnected' | 'connected' | 'error'

function toast(msg: string) {
  try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
}

export default function GoogleConnectCard() {
  const [status, setStatus] = React.useState<Status>('unknown')
  const [email, setEmail] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [calChoice, setCalChoice] = React.useState<'primary' | 'custom'>('primary')
  const [customCalId, setCustomCalId] = React.useState('')

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const ok = isSignedIn()
        if (!alive) return
        setStatus(ok ? 'connected' : 'disconnected')
        if (ok) {
          const token = await getAccessToken()
          if (!alive) return
          if (token) {
            // Best-effort: fetch profile email (purely cosmetic). Ignore failure.
            try {
              const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (res.ok) {
                const j: any = await res.json().catch(() => ({}))
                setEmail(j?.email || null)
              }
            } catch {}
          }
        } else {
          setEmail(null)
        }
      } catch (e: any) {
        if (!alive) return
        setStatus('error')
        setError(String(e?.message || e))
      }
    })()
    return () => { alive = false }
  }, [])

  function ensureProviderEnabled(calId: string) {
    const cfg = readSyncConfig()
    const next = {
      ...cfg,
      enabled: true,
      windowWeeks: cfg.windowWeeks || 8,
      providers: {
        ...(cfg.providers || {}),
        google: {
          enabled: true,
          accountKey: 'google-default',
          calendars: [calId || 'primary'],
        },
        apple: cfg.providers?.apple ?? { enabled: false },
      },
    }
    writeSyncConfig(next)
  }

  async function onConnect() {
    setBusy(true)
    setError(null)
    try {
      // Kick off OAuth; the redirect handler in main.tsx will bring us back to /settings
      await beginAuth(['https://www.googleapis.com/auth/calendar'])
      // No code after this line runs immediately because the page navigates.
    } catch (e: any) {
      setBusy(false)
      setError(String(e?.message || e))
    }
  }

  async function onDisconnect() {
    setBusy(true)
    setError(null)
    try {
      oauthDisconnect()
      // Also disable google in sync config so the loop quiets down
      const cfg = readSyncConfig()
      const next = {
        ...cfg,
        providers: { ...(cfg.providers || {}), google: { enabled: false, calendars: [] } as any },
      }
      writeSyncConfig(next)
      setStatus('disconnected')
      setEmail(null)
      toast('Google disconnected.')
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function onSaveCalendarPrefs() {
    const calId = calChoice === 'primary' ? 'primary' : (customCalId.trim() || 'primary')
    ensureProviderEnabled(calId)
    toast(`Google sync is ON (${calId}).`)
  }

  const connected = status === 'connected'
  const disconnected = status === 'disconnected'
  const hasError = status === 'error'

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <h3 style={h3}>Google Calendar</h3>
          <p style={hint}>
            {connected ? (
              <>
                Connected{email ? <> as <strong>{email}</strong></> : null}. Choose the calendar and sync.
              </>
            ) : hasError ? (
              <>Error while checking status.</>
            ) : (
              <>Connect your Google account to sync events both ways.</>
            )}
          </p>
          {hasError && <p style={{ color: 'crimson', fontSize: 12, whiteSpace: 'pre-wrap' }}>{error}</p>}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {connected ? (
            <>
              <button
                type="button"
                data-fc-sync-now
                disabled={busy}
                title="Run sync immediately"
              >
                Sync now
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                disabled={busy}
                style={{ color: 'crimson' }}
                title="Disconnect Google"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={onConnect}
              disabled={busy}
              title="Connect to Google"
            >
              {busy ? 'Opening…' : 'Connect Google'}
            </button>
          )}
        </div>
      </div>

      {/* Calendar preference (only useful when connected, but harmless otherwise) */}
      <div style={{ marginTop: 12, display: 'grid', gap: 8, maxWidth: 560 }}>
        <div style={row}>
          <label style={{ minWidth: 140 }}>Calendar</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="gcal-choice"
                value="primary"
                checked={calChoice === 'primary'}
                onChange={() => setCalChoice('primary')}
              />
              <span>Primary</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="gcal-choice"
                value="custom"
                checked={calChoice === 'custom'}
                onChange={() => setCalChoice('custom')}
              />
              <span>Custom ID</span>
            </label>
            <input
              placeholder="e.g. someone@example.com"
              value={customCalId}
              onChange={(e) => setCustomCalId(e.currentTarget.value)}
              disabled={calChoice !== 'custom'}
              style={{ minWidth: 260 }}
            />
            <button type="button" onClick={onSaveCalendarPrefs} disabled={busy}>
              Save
            </button>
          </div>
        </div>

        <div style={{ ...hint, marginTop: -4 }}>
          If you don’t know the calendar ID, keep <strong>Primary</strong>. You can press <em>Sync now</em> anytime.
        </div>
      </div>
    </div>
  )
}

/* ---------- local styles (kept lightweight to match your Settings page) ---------- */

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
}

const h3: React.CSSProperties = { margin: '0 0 4px', fontSize: 18 }
const hint: React.CSSProperties = { color: '#64748b', fontSize: 12, margin: 0 }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
