// frontend/src/pages/Settings.tsx
import React, { useEffect, useState } from 'react'
import SettingsPage from '../components/SettingsPage'
import { featureFlags } from '../state/featureFlags'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../state/settings'
import IntegrationsPanel from '../components/integrations/IntegrationsPanel'

type Flags = ReturnType<typeof featureFlags.get>

export default function Settings() {
  const [flags, setFlags] = useState<Flags>(() => featureFlags.get())
  useEffect(() => {
    const unsub = featureFlags.subscribe(() => setFlags(featureFlags.get()))
    return () => unsub()
  }, [])

  function onToggleAuth(e: React.ChangeEvent<HTMLInputElement>) {
    const on = e.currentTarget.checked
    featureFlags.set({ authEnabled: on })
    setTimeout(() => window.location.reload(), 0)
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Your full baseline settings UI */}
      <SettingsPage />

      {/* Experiments (unchanged) */}
      <section style={card}>
        <h3 style={h3}>Experiments</h3>
        <label style={row}>
          <input
            type="checkbox"
            checked={!!flags.authEnabled}
            onChange={onToggleAuth}
          />
          <span>Enable accounts (sign-in)</span>
        </label>
        <p style={hint}>When disabled, the app behaves exactly like Slice A/B.</p>
      </section>

      {/* Account (unchanged) */}
      {flags.authEnabled && <AccountPanel />}

      {/* Integrations (unchanged). This already contains the Google card.
          IMPORTANT: We do NOT render a second Google tile anymore. */}
      <IntegrationsPanel />

      {/* Optional: small helper for tracing + token reset (doesn't duplicate Google UI) */}
      <DeveloperSyncTools />
    </div>
  )
}

function DeveloperSyncTools() {
  const [trace, setTrace] = React.useState<boolean>(() => {
    try { return localStorage.getItem('fc_sync_trace_v1') === '1' } catch { return false }
  })

  const toggleTrace = (on: boolean) => {
    try { localStorage.setItem('fc_sync_trace_v1', on ? '1' : '0') } catch {}
    setTrace(on)
    try { window.dispatchEvent(new CustomEvent('toast', { detail: `Developer trace ${on ? 'on' : 'off'}.` })) } catch {}
  }

  const resetGoogleSync = () => {
    try { localStorage.removeItem('fc_google_sync_token_v1') } catch {}
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Google sync token cleared.' })) } catch {}
    try { window.dispatchEvent(new Event('fc:sync-now')) } catch {}
  }

  return (
    <section style={card}>
      <h3 style={h3}>Developer trace</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={row}>
          <input type="checkbox" checked={trace} onChange={e => toggleTrace(e.currentTarget.checked)} />
          <span>Write extra sync output to console</span>
        </label>
        <button onClick={resetGoogleSync}>Reset Google sync</button>
      </div>
      <p style={hint}>
        If you ever see <code>syncTokenWithNonDefaultOrdering</code> or stale data, reset the token to force a fresh pull.
      </p>
    </section>
  )
}

function AccountPanel() {
  const { currentUser, linkMember, unlinkMember } = useAuth()
  const s = useSettings()
  const members = Array.isArray((s as any).members) ? (s as any).members : []

  return (
    <section style={card}>
      <h3 style={h3}>Account</h3>

      {!currentUser ? (
        <>
          <p style={hint}>Not signed in. Use the button in the top-right to sign in with a seed account.</p>
          <p style={hint}>
            Seed users: <code>parent@local.test</code> / <code>parent123</code>,
            <code> adult@local.test</code> / <code>adult123</code>,
            <code> child@local.test</code> / <code>child123</code>.
          </p>
        </>
      ) : (
        <>
          <div style={box}>
            <div><strong>{currentUser.email}</strong></div>
            <div>Role: {currentUser.role}</div>
          </div>

          <div style={{ ...box, marginTop: 12 }}>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>Link my members</div>
            {members.length === 0 && <div style={hint}>No members yet. Add members in Settings above.</div>}
            <div style={{ display: 'grid', gap: 6 }}>
              {members.map((m: any) => {
                const linked = currentUser.linkedMemberIds.includes(m.id)
                return (
                  <label key={m.id} style={row}>
                    <input
                      type="checkbox"
                      checked={linked}
                      onChange={(e) => e.currentTarget.checked ? linkMember(m.id) : unlinkMember(m.id)}
                    />
                    <span>{m.name}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

/* ---------------- styles (match your baseline) ---------------- */

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
}

const h3: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: 18,
}

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const box: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

const hint: React.CSSProperties = {
  color: '#64748b',
  fontSize: 12,
  margin: '6px 0 0 0',
}
