import React from 'react'

const KEY = 'fc_my_agenda_v1'

function readState(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'false')
    return typeof v === 'boolean' ? v : !!v?.on
  } catch { return false }
}
function writeState(on: boolean) {
  localStorage.setItem(KEY, JSON.stringify({ on }))
  try {
    window.dispatchEvent(new CustomEvent('fc:my-agenda:changed'))
    window.dispatchEvent(new CustomEvent('fc:events-changed'))
  } catch {}
}

export default function MyAgendaSwitch() {
  const [on, setOn] = React.useState(readState())

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e && e.key === KEY) setOn(readState())
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
