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
      localStorage.removeItem('fc_google_oauth_v1')
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

/* === Global toaster so ?sync=on/off shows a message === */
import Toaster from './components/Toaster'

/* ===== Slice D: Sync bootstrap ===== */
import { startSyncLoop, maybeRunSync } from './sync/bootstrap'
import { readSyncConfig, writeSyncConfig } from './sync/core'

/* ===== Handle Google OAuth redirect on boot ===== */
import { maybeHandleRedirect } from './google/oauth'

// NEW: soft import types to avoid build break if oauth.ts doesn’t export this
import * as GoogleOAuthMod from './google/oauth'

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
      try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync enabled (Google).' })) } catch {}
      setTimeout(() => { try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync enabled (Google).' })) } catch {} }, 500)
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
  maybeRunSync()
  startSyncLoop()
}

// --------- START APP ----------
async function startApp() {
  try {
    await maybeHandleRedirect()
  } catch (e) {
    console.warn('OAuth redirect handling failed:', e)
  }

  if (location.pathname === '/oauth2/callback') {
    history.replaceState({}, '', '/settings')
  }

  // NEW: wire the card’s connect button to your oauth module
  window.addEventListener('fc:google-oauth-start', (ev: Event) => {
    const ce = ev as CustomEvent<{ redirect?: string }>
    const redirect = ce?.detail?.redirect || '/settings'
    const fn = (GoogleOAuthMod as any).startGoogleOAuth
    if (typeof fn === 'function') {
      try {
        fn({ redirect })
      } catch (e) {
        console.warn('startGoogleOAuth failed:', e)
        alert('Could not start Google sign-in.')
      }
    } else {
      // Fallback: older deployments might have used a server route
      try {
        const url = new URL('/oauth2/start', window.location.origin)
        url.searchParams.set('provider', 'google')
        url.searchParams.set('redirect', redirect)
        window.location.assign(url.toString())
      } catch {
        alert('Google sign-in is not configured in this build.')
      }
    }
  })

  // migrations + sync
  migrateSliceC()
  bootstrapSync()

  function RootApp() {
    const [pulse, setPulse] = React.useState(0)
    return (
      <React.StrictMode>
        <SettingsProvider>
          <AuthProvider>
            <BrowserRouter>
              <Toaster />
              <AgendaRefreshBridge onPulse={() => setPulse(p => (p + 1) % 1_000_000)} />
              <SignInDock />
              <Routes key={pulse}>
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
}

startApp()
