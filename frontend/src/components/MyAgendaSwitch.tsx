// frontend/src/components/MyAgendaSwitch.tsx
import React from 'react'

function readState(): boolean {
  try { return !!JSON.parse(localStorage.getItem('fc_my_agenda_v1') || '{}').on }
  catch { return false }
}
function writeState(on: boolean) {
  localStorage.setItem('fc_my_agenda_v1', JSON.stringify({ on }))
  // Nudge the app to refresh without full reload
  try { window.dispatchEvent(new CustomEvent('fc:settings:changed')) } catch {}
}

export default function MyAgendaSwitch() {
  const [on, setOn] = React.useState(readState())

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e && e.key === 'fc_my_agenda_v1') setOn(readState())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <label
      title="Show only events that involve your linked members"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        border: '1px solid var(--border)',
        borderRadius: 999,
        background: 'var(--surface)',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => { const v = e.target.checked; setOn(v); writeState(v) }}
        style={{ margin: 0 }}
        aria-label="My agenda"
      />
      <span>My agenda</span>
    </label>
  )
}
