// frontend/src/components/AccountMenu.tsx
import React from 'react'
import { useAuth } from '../auth/AuthProvider'

function roleLabel(r?: string) {
  if (r === 'parent') return 'Parent'
  if (r === 'adult') return 'Adult'
  if (r === 'child') return 'Child'
  return '—'
}
function initial(s: string) {
  const t = s.trim()
  if (!t) return '•'
  const ch = t[0].toUpperCase()
  return /[A-Z0-9]/.test(ch) ? ch : '•'
}

export default function AccountMenu() {
  const { currentUser, signIn, signOut } = useAuth()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current) return; if (!ref.current.contains(e.target as any)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="account-menu" style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        aria-label="Account"
        title={currentUser ? `${currentUser.email} (${roleLabel(currentUser.role)})` : 'Sign in'}
        onClick={() => setOpen(v => !v)}
        style={{
          width: 32, height: 32, borderRadius: '50%',
          display: 'grid', placeItems: 'center',
          border: '1px solid var(--border)', background: 'var(--surface)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {currentUser ? initial(currentUser.email) : '↪'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', right: 0, top: 40, minWidth: 220,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,.12)', padding: 8, zIndex: 50,
          }}
        >
          {currentUser ? (
            <>
              <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--muted)' }}>
                Signed in as <strong>{currentUser.email}</strong><br />
                Role: <strong>{roleLabel(currentUser.role)}</strong>
              </div>
              <div style={{ height: 8 }} />
              <button className="ghost" onClick={() => { setOpen(false); signOut() }} style={{ width: '100%' }}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--muted)' }}>
                Not signed in
              </div>
              <div style={{ height: 8 }} />
              <button className="primary" onClick={() => { setOpen(false); signIn() }} style={{ width: '100%' }}>
                Sign in
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
