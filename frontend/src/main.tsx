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
import './styles.css'

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    <SettingsProvider>
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
    </SettingsProvider>
  </React.StrictMode>
)
