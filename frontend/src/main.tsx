// frontend/src/main.tsx
// Reset switch (?reset=1) to clear local data if needed
if (typeof window !== 'undefined') {
  const url = new URL(window.location.href)
  if (url.searchParams.get('reset') === '1') {
    try {
      localStorage.removeItem('fc_events_v1')
      localStorage.removeItem('fc_settings_v1')
      localStorage.removeItem('fc_settings_v2')
      localStorage.removeItem('fc_settings_v3') // current
      localStorage.removeItem('fc_users_v1')
      localStorage.removeItem('fc_current_user_v1')
      localStorage.removeItem('fc_my_agenda_v1')
      localStorage.removeItem('fc_feature_flags_v1')
      alert('Local data cleared. Reloading…')
    } catch {}
    url.searchParams.delete('reset')
    window.location.replace(url.toString())
  }
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppLayout from './App'
import Home from './pages/Home'
import Calendar from './pages/Calendar'
import Lists from './pages/Lists'
import Chores from './pages/Chores'
import Meals from './pages/Meals'
import Settings from './pages/Settings'
import { SettingsProvider } from './state/settings'
import AgendaRefreshBridge from './components/AgendaRefreshBridge'
import SignInDock from './components/SignInDock'
import { AuthProvider } from './auth/AuthProvider'
import { migrateSliceC } from './lib/migrateSliceC'
import './styles.css'

/* === NEW: global toaster so ?sync=on/off shows a message === */
import Toaster from './components/Toaster'

/* ===== Slice D: Sync bootstrap (additive, no UI changes) ===== */
import { startSyncLoop, maybeRunSync } from './sync/bootstrap'
import { readSyncConfig, writeSyncConfig } from './sync/core'

function handleSyncURLToggle() {
  try {
    const url = new URL(window.location.href)
    const sync = url.searchParams.get('sync')
    if (!sync) return

    const cfg = readSyncConfig()
    if (sync === 'on') {
      const next = {
        ...cfg,
        enabled: true,
        providers: {
          ...(cfg.providers || {}),
          google: {
            enabled: true,
            accountKey: cfg.providers?.google?.accountKey,
            calendars: cfg.providers?.google?.calendars || [],
          },
          apple: {
            enabled: false,
            accountKey: cfg.providers?.apple?.accountKey,
            calendars: cfg.providers?.apple?.calendars || [],
          },
        },
        windowWeeks: cfg.windowWeeks || 8,
      }
      writeSyncConfig(next)
      url.searchParams.delete('sync')
      window.history.replaceState({}, '', url.toString())
      // fire once now (may be before React mounts) and once after mount
      try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync enabled (Google stub).' })) } catch {}
      setTimeout(() => { try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync enabled (Google stub).' })) } catch {} }, 500)
    } else if (sync === 'off') {
      const next = { ...cfg, enabled: false }
      writeSyncConfig(next)
      url.searchParams.delete('sync')
      window.history.replaceState({}, '', url.toString())
      try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync disabled.' })) } catch {}
      setTimeout(() => { try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync disabled.' })) } catch {} }, 500)
    }
  } catch {
    // ignore
  }
}

function bootstrapSync() {
  handleSyncURLToggle()
  // Safe to call → both are no-ops unless sync is enabled
  maybeRunSync()
  startSyncLoop() // 5 min interval by default; also ticks on visibility change
}
/* ===== End Slice D: Sync bootstrap ===== */

// Run safe, idempotent migration (won't overwrite bootstrap defaults)
migrateSliceC()

// Start sync bootstrap *after* migrations (does nothing unless you used ?sync=on)
bootstrapSync()

function RootApp() {
  // “Pulse” causes the routed subtree to remount whenever auth/agenda/flags change.
  const [pulse, setPulse] = React.useState(0)

  return (
    <React.StrictMode>
      <SettingsProvider>
        <AuthProvider>
          <BrowserRouter>
            {/* Global toaster lives once for whole app */}
            <Toaster />

            {/* Invisible: listens for account/link/toggle/flag changes */}
            <AgendaRefreshBridge onPulse={() => setPulse(p => (p + 1) % 1_000_000)} />

            {/* Fixed overlay that shows Sign in + My Agenda (only when accounts are enabled) */}
            <SignInDock />

            <Routes key={pulse}>
              {/* Remount AppLayout + children when pulse changes (keeps your original App.tsx/nav intact) */}
              <Route element={<AppLayout />}>
                <Route index element={<Home />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="lists" element={<Lists />} />
                <Route path="chores" element={<Chores />} />
                <Route path="meals" element={<Meals />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </SettingsProvider>
    </React.StrictMode>
  )
}

const root = document.getElementById('root')!
createRoot(root).render(<RootApp />)
