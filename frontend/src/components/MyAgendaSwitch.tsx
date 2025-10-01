// frontend/src/components/MyAgendaSwitch.tsx
// Floating "My agenda" toggle that stores state in fc_my_agenda_v1 (never touches fc_settings_v3).

import React, { useEffect, useState } from 'react'
import { featureFlags } from '../state/featureFlags'
import { useAuth } from '../auth/AuthProvider'

const LS_MYAGENDA = 'fc_my_agenda_v1'
const LS_EVENTS   = 'fc_events_v1'

function readMyAgendaOnly(): boolean {
  try {
    const raw = localStorage.getItem(LS_MYAGENDA)
    const obj = raw ? JSON.parse(raw) : {}
    return !!obj.on
  } catch { return false }
}

function writeMyAgendaOnly(on: boolean) {
  try {
    localStorage.setItem(LS_MYAGENDA, JSON.stringify({ on: !!on }))
    try { window.dispatchEvent(new CustomEvent('fc:settings:changed')) } catch {}
  } catch {}
}

function pokeEventsRefresh() {
  try {
    const v = localStorage.getItem(LS_EVENTS)
    localStorage.setItem(LS_EVENTS, v ?? '[]')
    try { window.dispatchEvent(new CustomEvent('fc:events:changed')) } catch {}
  } catch {}
}

export default function MyAgendaSwitch() {
  const { currentUser } = useAuth()

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
          onChange={e => {
            const next = e.currentTarget.checked
            writeMyAgendaOnly(next)
            setOn(next)
            pokeEventsRefresh()
          }}
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
