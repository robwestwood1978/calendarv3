// frontend/src/components/AccountMenu.tsx
// Shows a small account button (top-right) when the auth feature flag is ON.
// Subscribes to the flag so it appears/disappears immediately on toggle.

import React, { useEffect, useRef, useState } from 'react'
import { featureFlags } from '../state/featureFlags'
import { useAuth } from '../auth/AuthProvider'

export default function AccountMenu() {
  const { currentUser, signIn, signOut } = useAuth()

  // React to feature flag changes live
  const [enabled, setEnabled] = useState<boolean>(() => featureFlags.get().authEnabled)
  useEffect(() => {
    const unsub = featureFlags.subscribe(() => setEnabled(featureFlags.get().authEnabled))
    return () => unsub()
  }, [])

  // If experiments are OFF, render nothing (keeps A/B identical)
  if (!enabled) return null

  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('parent@local.test')
  const [password, setPassword] = useState('parent123')
  const [error, setError] = useState<string | null>(null)

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
              <p style={styles.hint}>
                Seed users: parent@local.test / <code>parent123</code>,
                adult@local.test / <code>adult123</code>,
                child@local.test / <code>child123</code>.
              </p>
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
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: 'fixed', top: 8, right: 8, zIndex: 50 },
  btn: {
    width: 36, height: 36, borderRadius: 18, border: '1px solid #cbd5e1', background: 'white',
    fontWeight: 700, cursor: 'pointer',
  },
  pop: {
    position: 'absolute', right: 0, marginTop: 8, padding: 12,
    width: 280, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8,
    boxShadow: '0 10px 25px rgba(0,0,0,.08)',
  },
  hint: { color: '#64748b', fontSize: 12, margin: 0 },
  err: { color: '#b91c1c', fontSize: 12 },
}
