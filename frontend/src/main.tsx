// frontend/src/main.tsx
// Resets (?reset=1), bootstraps router, starts sync, wires Google connect + diagnostics button.

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
      localStorage.removeItem('fc_sync_cfg')
      localStorage.removeItem('fc_sync_tokens')
      localStorage.removeItem('fc_sync_journal')
      localStorage.removeItem('fc_sync_shadow')
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

/* === Global toaster === */
import Toaster from './components/Toaster'

/* ===== Sync bootstrap ===== */
import { startSyncLoop, maybeRunSync } from './sync/bootstrap'
import { readSyncConfig, writeSyncConfig } from './sync/core'

/* ===== Google OAuth redirect ===== */
import { maybeHandleRedirect } from './google/oauth'
import * as GoogleOAuthMod from './google/oauth'

// --- Diagnostics toggle (no IIFE mistakes)
(function setupDiagnosticsButton() {
  try {
    // Ctrl/⌘ + Alt + S toggles diagnostics flag
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const isToggle = (e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 's'
      if (!isToggle) return
      const on = !(window as any).FC_TRACE
      ;(window as any).FC_TRACE = on
      try { window.dispatchEvent(new CustomEvent('toast', { detail: on ? 'Diagnostics ON' : 'Diagnostics OFF' })) } catch {}
    })

    // If ?trace=1 in URL, show a floating button to open the inspector
    const url = new URL(location.href)
    if (url.searchParams.get('trace') === '1') {
      const btn = document.createElement('button')
      btn.textContent = 'Sync Inspector'
      Object.assign(btn.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '9999',
        padding: '8px 10px',
        borderRadius: '10px',
        border: '1px solid #e5e7eb',
        background: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,.1)',
        cursor: 'pointer',
      } as CSSStyleDeclaration)
      btn.onclick = () => window.dispatchEvent(new CustomEvent('fc:open-sync-inspector'))
      window.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn))
    }
  } catch {}
})()

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

  // Wire the Google connect button used by GoogleConnectCard
  window.addEventListener('fc:google-oauth-start', (ev: Event) => {
    const ce = ev as CustomEvent<{ redirect?: string }>
    const redirect = ce?.detail?.redirect || '/settings'
    const fn = (GoogleOAuthMod as any).beginAuth || (GoogleOAuthMod as any).startGoogleOAuth
    if (typeof fn === 'function') {
      try { fn(['https://www.googleapis.com/auth/calendar']) } catch (e) {
        console.warn('Google OAuth start failed:', e)
        alert('Could not start Google sign-in.')
      }
    } else {
      // Fallback: legacy server route
      try {
        const url = new URL('/oauth2/start', window.location.origin)
        url.searchParams.set('provider', 'google')
        url.searchParams.set('redirect', redirect)
        window.location.assign(url.toString())
      } catch {
        alert('Google sign-in is not available in this build.')
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
