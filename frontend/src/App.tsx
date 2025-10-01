// frontend/src/App.tsx
import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import AccountMenu from './components/AccountMenu'
import MyAgendaSwitch from './components/MyAgendaSwitch'
import AgendaRefreshBridge from './components/AgendaRefreshBridge'

export default function AppLayout() {
  const [pulse, setPulse] = React.useState(0)

  return (
    <div className="app">
      <header className="topbar">
        <nav className="tabs">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/calendar">Calendar</NavLink>
          <NavLink to="/lists">Lists</NavLink>
          <NavLink to="/chores">Chores</NavLink>
          <NavLink to="/meals">Meals</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="spacer" />
        <MyAgendaSwitch />
        <AccountMenu />
      </header>

      {/* Bridge listens for agenda/auth changes and bumps pulse → forces subtree re-render */}
      <AgendaRefreshBridge onPulse={() => setPulse(p => (p + 1) % 1000000)} />

      {/* The key ensures Outlet subtree remounts when pulse changes */}
      <main key={pulse}>
        <Outlet />
      </main>
    </div>
  )
}
