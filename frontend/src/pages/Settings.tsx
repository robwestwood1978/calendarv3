// frontend/src/pages/Settings.tsx
// Your original SettingsPage + IntegrationsPanel, unchanged,
// plus ONE Google Calendar card that plugs into the existing sync plumbing.

import React, { useEffect, useState } from 'react'
import SettingsPage from '../components/SettingsPage'
import { featureFlags } from '../state/featureFlags'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../state/settings'

// Your existing ICS/Apple panel (unchanged)
import IntegrationsPanel from '../components/integrations/IntegrationsPanel'

// NEW: two-way Google connector card (kept separate from ICS)
import GoogleConnectCard from '../components/integrations/GoogleConnectCard'

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
    // reload so the top-right sign-in dock and protected routes refresh
    setTimeout(() => window.location.reload(), 0)
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ===== Your full Settings UI (members, colours, pills, tags, what-to-bring, etc.) ===== */}
      <SettingsPage />

      {/* ===== Experiments (unchanged) ===== */}
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

      {/* ===== Account (unchanged) ===== */}
      {flags.authEnabled && <AccountPanel />}

      {/* ===== Integrations (read-only ICS / Apple) — unchanged ===== */}
      <IntegrationsPanel />

      {/* ===== Two-way Google Calendar (OAuth) =====
         - Only one card is rendered.
         - This does NOT affect your ICS panel.
         - Feature-flagged so you can hide it quickly if needed. */}
      {featureFlags.get().google !== false && (
        <section style={card}>
          <h3 style={h3}>Google Calendar</h3>
          <p style={hint}>
            Connect your Google account to pull and push events within your sync window.
            You can disconnect or reset the sync token at any time.
          </p>
          <div style={{ marginTop: 8 }}>
            <GoogleConnectCard />
          </div>
        </section>
      )}
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
                      onChange={(e) =>
                        e.currentTarget.checked ? linkMember(m.id) : unlinkMember(m.id)
                      }
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
