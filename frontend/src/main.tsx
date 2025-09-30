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
      localStorage.removeItem('fc_feature_flags_v1')
      localStorage.removeItem('fc_users_v1')
      localStorage.removeItem('fc_current_user_v1')
      alert('Local data cleared. Reloading…')
    } catch {}
    url.searchParams.delete('reset')
    window.location.replace(url.toString())
  }
}

// Slice C preflight (safe, idempotent; shapes only)
import './lib/migrateSliceC'
// Slice C runtime patches (safe when flag is OFF)
import './lib/agendaPatch'
import './lib/permissionsPatch'

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
import { AuthProvider } from './auth/AuthProvider'
import AccountMenu from './components/AccountMenu'
import MyAgendaSwitch from './components/MyAgendaSwitch'
import './styles.css'

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    <SettingsProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
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

        {/* Slice C overlays (render nothing when flag OFF) */}
        <AccountMenu />
        <MyAgendaSwitch />
      </AuthProvider>
    </SettingsProvider>
  </React.StrictMode>
)
