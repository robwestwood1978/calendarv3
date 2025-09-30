// frontend/src/components/MyAgendaSwitch.tsx
// Small floating switch (top-right under the account button).
// Visible only when the accounts flag is ON and a user is signed in.

import React, { useEffect, useState } from 'react'
import { featureFlags } from '../state/featureFlags'
import { useAuth } from '../auth/AuthProvider'

const LS_SETTINGS = 'fc_settings_v3'

function readMyAgendaOnly(): boolean {
  try {
    const raw = localStorage.getItem(LS_SETTINGS)
    const obj = raw ? JSON.parse(raw) : {}
    return !!obj.myAgendaOnly
  } catch { return false }
}

function writeMyAgendaOnly(on: boolean) {
  try {
    const raw = localStorage.getItem(LS_SETTINGS)
    const obj = raw ? JSON.parse(raw) : {}
    obj.myAgendaOnly = !!on
    localStorage.setItem(LS_SETTINGS, JSON.stringify(obj))
    try { window.dispatchEvent(new CustomEvent('fc:settings:changed')) } catch {}
  } catch {}
}

export default function MyAgendaSwitch() {
  const { currentUser } = useAuth()

  // react to flag changes live
  const [enabled, setEnabled] = useState<boolean>(() => featureFlags.get().authEnabled)
  useEffect(() => {
    const unsub = featureFlags.subscribe(() => setEnabled(featureFlags.get().authEnabled))
    return () => unsub()
  }, [])

  const [on, setOn] = useState<boolean>(() => readMyAgendaOnly())
  useEffect(() => {
    const h = () => setOn(readMyAgendaOnly())
    window.addEventListener('fc:settings:changed', h)
    window.addEventListener('storage', h)
    return () => { window.removeEventListener('fc:settings:changed', h); window.removeEventListener('storage', h) }
  }, [])

  if (!enabled || !currentUser) return null

  return (
    <div style={root}>
      <label style={pill}>
        <input
          type="checkbox"
          checked={on}
          onChange={e => { writeMyAgendaOnly(e.currentTarget.checked); setOn(e.currentTarget.checked) }}
        />
        <span>My agenda</span>
      </label>
    </div>
  )
}

const root: React.CSSProperties = {
  position: 'fixed', top: 52, right: 8, zIndex: 49,
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 9999, padding: '6px 10px',
  boxShadow: '0 10px 25px rgba(0,0,0,.06)', userSelect: 'none'
}
