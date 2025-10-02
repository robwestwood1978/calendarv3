// frontend/src/components/SignInDock.tsx
import React from 'react'
import AccountMenu from './AccountMenu'
import MyAgendaSwitch from './MyAgendaSwitch'

function authEnabled(): boolean {
  try {
    const f = JSON.parse(localStorage.getItem('fc_feature_flags_v1') || '{}')
    return !!f.authEnabled
  } catch { return false }
}

export default function SignInDock() {
  const [, force] = React.useState(0)

  // Re-check flag on storage changes
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e && e.key === 'fc_feature_flags_v1') force(x => x + 1)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (!authEnabled()) return null

  return (
    <div
      aria-label="Accounts and agenda"
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        display: 'flex',
        gap: 8,
        zIndex: 1000,
      }}
    >
      <MyAgendaSwitch />
      <AccountMenu />
    </div>
  )
}
