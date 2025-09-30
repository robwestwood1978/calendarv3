// frontend/src/components/AccountMenu.tsx
// Small overlay button in the top-right. Renders NOTHING when the feature flag is OFF.
// Keep CSS minimal; does not change your header or layout.
// Shows a simple sign-in form for seed users; shows email/role and a sign-out when signed in.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { featureFlags } from '../state/featureFlags'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../state/settings'

export default function AccountMenu() {
  const { currentUser, signIn, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('parent@local.test')
  const [password, setPassword] = useState('parent123')
  const [error, setError] = useState<string | null>(null)

  // Respect feature flag
  const flags = useMemo(() => featureFlags.get(), [])
  if (!flags.authEnabled) return null

  // close on outside click
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!boxRef.current) return
      if (!boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function doSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const ok = await signIn(email, password)
    if (!ok) { setError('Sign in failed. Check your email and password.'); return }
    setOpen(false)
  }

  const initial = currentUser ? currentUser.email.charAt(0).toUpperCase() : '↪'

  return (
    <>
      <div style={styles.root}>
        <button aria-label="Account" style={styles.btn} onClick={() => setOpen(v => !v)}>
          {initial}
        </button>
        {open && (
          <div ref={boxRef} style={styles.pop}>
            {!currentUser ? (
              <form onSubmit={doSignIn} style={{ display: 'grid', gap: 8 }}>
                <strong>Sign in</strong>
                <input
                  type="email"
                  placeholder="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                />
                <input
                  type="password"
                  placeholder="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                {error && <div style={styles.err}>{error}</div>}
                <button type="submit" className="primary">Sign in</button>
                <p style={styles.hint}>Seed users: parent@local.test / parent123; adult@local.test / adult123; child@local.test / child123.</p>
              </form>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <div><strong>{currentUser.email}</strong></div>
                <div>Role: {currentUser.role}</div>
                <button onClick={() => { signOut(); setOpen(false) }}>Sign out</button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed', top: 8, right: 8, zIndex: 50,
  },
  btn: {
    width: 36, height: 36, borderRadius: 18, border: '1px solid #cbd5e1', background: 'white',
    fontWeight: 700, cursor: 'pointer',
  },
  pop: {
    position: 'absolute', right: 0, marginTop: 8, padding: 12,
    width: 280, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,.08)',
  },
  hint: { color: '#64748b', fontSize: 12, margin: 0 },
  err: { color: '#b91c1c', fontSize: 12 },
}
