// frontend/src/App.tsx
import React from 'react'
import { Outlet } from 'react-router-dom'
import NavBar from './components/NavBar'
import ErrorBoundary from './components/ErrorBoundary'
import './styles.css'

/**
 * AppLayout is used by routes in main.tsx:
 * <Route element={<AppLayout />}> ... </Route>
 * It should NOT include BrowserRouter or SettingsProvider (those are already in main.tsx).
 */
export default function AppLayout() {
  return (
    <ErrorBoundary>
      <div className="calendar-page">
        {/* Route content renders here */}
        <Outlet />
        {/* Floating bottom navigation */}
        <NavBar />
      </div>
    </ErrorBoundary>
  )
}
