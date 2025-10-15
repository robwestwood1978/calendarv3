import React from 'react'
import { Link } from 'react-router-dom'

/** ===== Sync config (window state) ===== */
import { readSyncConfig, writeSyncConfig } from '../sync/core'
import { maybeRunSync, startSyncLoop } from '../sync/bootstrap'

/** Small helpers so we don’t pull extra deps */
const get = (k: string) => {
  try { return localStorage.getItem(k) } catch { return null }
}
const set = (k: string, v: string) => {
  try { localStorage.setItem(k, v) } catch {}
}
const rm = (k: string) => {
  try { localStorage.removeItem(k) } catch {}
}

/** Heuristic “connected to Google?” indicator.
 *  Your OAuth layer already stores fc_google_oauth_v1; this avoids importing internal auth code. */
function useGoogleConnected(): boolean {
  const [ok, setOk] = React.useState<boolean>(() => !!get('fc_google_oauth_v1'))
  React.useEffect(() => {
    const i = setInterval(() => setOk(!!get('fc_google_oauth_v1')), 750)
    return () => clearInterval(i)
  }, [])
  return ok
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 style={{ margin: 0, marginBottom: '0.75rem' }}>{title}</h2>
      {children}
    </section>
  )
}

/* ---------------- Google (single tile) ---------------- */

function GoogleCard() {
  const connected = useGoogleConnected()
  const [trace, setTrace] = React.useState<boolean>(() => get('fc_sync_trace_v1') === '1')
  const cfg = React.useMemo(() => readSyncConfig(), [])
  const googleEnabled = !!cfg.enabled && !!cfg.providers?.google?.enabled

  const enableSync = () => {
    const curr = readSyncConfig()
    const next = {
      ...curr,
      enabled: true,
      windowWeeks: curr.windowWeeks || 8,
      providers: {
        ...(curr.providers || {}),
        google: {
          enabled: true,
          accountKey: curr.providers?.google?.accountKey,
          calendars: curr.providers?.google?.calendars || [], // will be “primary” by adapter default
        },
        apple: {
          enabled: curr.providers?.apple?.enabled || false,
          accountKey: curr.providers?.apple?.accountKey,
          calendars: curr.providers?.apple?.calendars || [],
        },
      },
    }
    writeSyncConfig(next)
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync enabled (Google).' })) } catch {}
    maybeRunSync()
    startSyncLoop()
  }

  const disableSync = () => {
    const curr = readSyncConfig()
    writeSyncConfig({ ...curr, enabled: false })
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync disabled.' })) } catch {}
  }

  const toggleTrace = (on: boolean) => {
    set('fc_sync_trace_v1', on ? '1' : '0')
    setTrace(on)
    try { window.dispatchEvent(new CustomEvent('toast', { detail: `Developer trace ${on ? 'on' : 'off'}.` })) } catch {}
  }

  const resetSyncToken = () => {
    rm('fc_google_sync_token_v1')
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Google sync token cleared.' })) } catch {}
    // Nudge the loop
    try { window.dispatchEvent(new Event('fc:sync-now')) } catch {}
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Google Calendar</div>
          <div style={{ marginTop: 4, color: 'var(--muted)' }}>
            Status: <strong>{connected ? 'Connected' : 'Not connected'}</strong>
          </div>
          <div style={{ marginTop: 8, color: 'var(--muted)' }}>
            Uses your Google account to read events within your sync window. You can revoke access any time from Google’s
            <span> </span>
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">App access</a>.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!googleEnabled
            ? <button className="primary" onClick={enableSync} disabled={!connected}>Enable Sync</button>
            : <button onClick={disableSync}>Disable Sync</button>
          }
        </div>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '12px 0' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={trace}
            onChange={e => toggleTrace(e.currentTarget.checked)}
          />
          <span>Developer trace</span>
        </label>

        <button onClick={resetSyncToken} title="Clear incremental token and force a fresh window pull">
          Reset Google sync
        </button>
      </div>
    </div>
  )
}

/* ---------------- Tags & What to bring ---------------- */

function Pill({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <span className="chip" style={{ userSelect: 'none' }}>
      {label}
      <button
        type="button"
        className="chip-x"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        title="Remove"
      >
        ×
      </button>
    </span>
  )
}

function TagsCard() {
  // store keys match what you had before
  const [tags, setTags] = React.useState<string[]>(
    () => JSON.parse(get('fc_common_tags_v1') || '[]')
  )
  const [bring, setBring] = React.useState<string[]>(
    () => JSON.parse(get('fc_common_bring_v1') || '[]')
  )
  const [newTag, setNewTag] = React.useState('')
  const [newItem, setNewItem] = React.useState('')

  const persist = (k: 'tags' | 'bring', v: string[]) => {
    if (k === 'tags') { set('fc_common_tags_v1', JSON.stringify(v)); setTags(v) }
    else { set('fc_common_bring_v1', JSON.stringify(v)); setBring(v) }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Tags & What to Bring</h2>

      <div style={{ marginBottom: 10, fontWeight: 600 }}>Common Tags</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {tags.map((t, i) => (
          <Pill key={`${t}-${i}`} label={t} onRemove={() => persist('tags', tags.filter(x => x !== t))} />
        ))}
      </div>
      <div className="row gap" style={{ marginBottom: 16 }}>
        <input
          placeholder="Add tag"
          value={newTag}
          onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && newTag.trim()) { persist('tags', Array.from(new Set([...tags, newTag.trim()]))); setNewTag('') } }}
        />
        <button onClick={() => { if (newTag.trim()) { persist('tags', Array.from(new Set([...tags, newTag.trim()]))); setNewTag('') } }}>
          Add
        </button>
      </div>

      <div style={{ marginBottom: 10, fontWeight: 600 }}>Common “What to bring”</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {bring.map((t, i) => (
          <Pill key={`${t}-${i}`} label={t} onRemove={() => persist('bring', bring.filter(x => x !== t))} />
        ))}
      </div>
      <div className="row gap">
        <input
          placeholder="Add item"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && newItem.trim()) { persist('bring', Array.from(new Set([...bring, newItem.trim()]))); setNewItem('') } }}
        />
        <button onClick={() => { if (newItem.trim()) { persist('bring', Array.from(new Set([...bring, newItem.trim()]))); setNewItem('') } }}>
          Add
        </button>
      </div>
    </div>
  )
}

/* ---------------- Experiments (kept minimal) ---------------- */

function ExperimentsCard() {
  const [accounts, setAccounts] = React.useState<boolean>(() => get('fc_flag_accounts_v1') === '1')
  const toggle = (on: boolean) => { set('fc_flag_accounts_v1', on ? '1' : '0'); setAccounts(on) }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Experiments</h2>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={accounts} onChange={e => toggle(e.currentTarget.checked)} />
        <span>Enable accounts (sign-in)</span>
      </label>
      <div className="hint">When disabled, the app behaves exactly like Slice A/B.</div>
    </div>
  )
}

/* ---------------- Page ---------------- */

export default function Settings() {
  return (
    <div className="admin">
      {/* SINGLE Google tile — the old/legacy Google card should be removed from your project so you don’t render it twice */}
      <GoogleCard />

      <TagsCard />

      <ExperimentsCard />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Help</h2>
        <div className="hint">
          Tip: If Google pull ever shows “syncTokenWithNonDefaultOrdering / 400”, click <em>Reset Google sync</em> above
          to clear the token, then wait a few seconds. You can also force a pull by reloading the page or clicking the
          <Link to="/calendar"> calendar</Link> tab again.
        </div>
      </div>
    </div>
  )
}
