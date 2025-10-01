// frontend/src/components/AgendaRefreshBridge.tsx
// Forces the app subtree to re-render when auth/agenda/flag changes.
// This does NOT change layout/UX; it just bumps a local key.

import React from 'react'

const KEYS = new Set(['fc_users_v1', 'fc_current_user_v1', 'fc_my_agenda_v1', 'fc_feature_flags_v1'])

export default function AgendaRefreshBridge({ onPulse }: { onPulse: () => void }) {
  React.useEffect(() => {
    const pulse = () => onPulse()
    const onStorage = (e: StorageEvent) => { if (!e || !e.key) return; if (KEYS.has(e.key)) pulse() }

    window.addEventListener('fc:users:changed', pulse)
    window.addEventListener('fc:settings:changed', pulse)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener('fc:users:changed', pulse)
      window.removeEventListener('fc:settings:changed', pulse)
      window.removeEventListener('storage', onStorage)
    }
  }, [onPulse])

  return null
}
