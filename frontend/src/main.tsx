// frontend/src/main.tsx
// Bootstraps app + sync. Keeps your original routes and providers.

if (typeof window !== 'undefined') {
  const url = new URL(window.location.href)
  if (url.searchParams.get('reset') === '1') {
    try {
      localStorage.removeItem('fc_events_v1')
      localStorage.removeItem('fc_settings_v1')
      localStorage.removeItem('fc_settings_v2')
      localStorage.removeItem('fc_settings_v3')
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

import Toaster from './components/Toaster'

// Sync engine
import { startSyncLoop, maybeRunSync } from './sync/bootstrap'
import { readSyncConfig, writeSyncConfig } from './sync/core'

// Google OAuth
import { maybeHandleRedirect } from './google/oauth'
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
            accountKey: cfg.providers?.google?.accountKey || 'google-default',
            calendars: cfg.providers?.google?.calendars || ['primary'],
          },
          apple: {
            enabled: cfg.providers?.apple?.enabled || false,
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
    } else if (sync === 'off') {
      const next = { ...cfg, enabled: false }
      writeSyncConfig(next)
      url.searchParams.delete('sync')
      window.history.replaceState({}, '', url.toString())
      try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Cloud sync disabled.' })) } catch {}
    }
  } catch {
    // ignore
  }
}

function bootstrapSync() {
  handleSyncURLToggle()
  // both are safe no-ops if sync is disabled
  maybeRunSync()
  startSyncLoop()
}

async function startApp() {
  // Handle possible OAuth callback first
  try {
    await maybeHandleRedirect()
  } catch (e) {
    console.warn('OAuth redirect handling failed:', e)
  }

  if (location.pathname === '/oauth2/callback') {
    history.replaceState({}, '', '/settings')
  }

  // Wire Google connect button → your oauth module
  window.addEventListener('fc:google-oauth-start', (ev: Event) => {
    const ce = ev as CustomEvent<{ redirect?: string }>
    const redirect = ce?.detail?.redirect || '/settings'
    const begin = (GoogleOAuthMod as any).beginAuth
    if (typeof begin === 'function') {
      try {
        begin(['https://www.googleapis.com/auth/calendar'])
      } catch (e) {
        console.warn('beginAuth failed:', e)
        alert('Could not start Google sign-in.')
      }
    } else {
      // Fallback to backend route if present
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

  // Run migrations and start sync loop
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
              <AgendaRefreshBridge onPulse={() => setPulse((p) => (p + 1) % 1_000_000)} />
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
