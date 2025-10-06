// frontend/src/App.tsx
import React from 'react'
import { Outlet } from 'react-router-dom'
import NavBar from './components/NavBar'
import ErrorBoundary from './components/ErrorBoundary'
import './styles.css'

export default function AppLayout() {
  return (
    <ErrorBoundary>
      <div className="calendar-page">
        <Outlet />
        <NavBar />
      </div>
    </ErrorBoundary>
  )
}
