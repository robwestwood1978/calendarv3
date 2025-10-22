// frontend/src/pages/Settings.tsx
// Single export. Keeps your original SettingsPage & IntegrationsPanel.
// Adds GoogleConnectCard and (optionally) SyncInspector button in trace mode.

import React, { useEffect, useState } from 'react'
import SettingsPage from '../components/SettingsPage'
import { featureFlags } from '../state/featureFlags'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../state/settings'
import IntegrationsPanel from '../components/integrations/IntegrationsPanel'
import GoogleConnectCard from '../components/integrations/GoogleConnectCard'
import SyncInspector from '../components/dev/SyncInspector'

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
      {/* Your household / appearance / tags etc. */}
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

      {/* Integrations (Apple/ICS) — unchanged */}
      <IntegrationsPanel />

      {/* Google Calendar — add once, below Integrations */}
      <section style={card}>
        <GoogleConnectCard />
        {/* Quick link to open inspector in trace mode */}
        {new URL(location.href).searchParams.get('trace') === '1' && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => window.dispatchEvent(new CustomEvent('fc:open-sync-inspector'))}>
              Open Sync Inspector
            </button>
          </div>
        )}
      </section>

      {/* The inspector component mounts once; it opens via event or hotkey */}
      <SyncInspector />
    </div>
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

/* ---------------- styles (unchanged) ---------------- */

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
