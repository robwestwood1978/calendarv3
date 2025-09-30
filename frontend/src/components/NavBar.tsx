// frontend/src/components/NavBar.tsx
import React from 'react'
import { Link, useLocation } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Home' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/settings', label: 'Settings' },
]

export default function NavBar() {
  const { pathname } = useLocation()
  return (
    <nav className="bottom-nav">
      {tabs.map(t => {
        const active = pathname === t.to || (t.to !== '/' && pathname.startsWith(t.to))
        return (
          <Link key={t.to} to={t.to} className={`nav-btn ${active ? 'active' : ''}`}>
            <span>{t.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
