// frontend/src/components/SignInDialog.tsx
import React from 'react'

export default function SignInDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>
}) {
  const [email, setEmail] = React.useState('parent@local.test')
  const [password, setPassword] = React.useState('parent123')
  const [err, setErr] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) { setErr(null); setBusy(false) }
  }, [open])

  if (!open) return null

  const submit = async () => {
    setBusy(true); setErr(null)
    const res = await onSubmit(email.trim(), password)
    setBusy(false)
    if (!res.ok) setErr(res.message || 'Sign in failed')
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Sign in">
      <div className="modal modern" onKeyDown={onKey}>
        <header className="modal-h">
          <h3>Sign in</h3>
          <button onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-b" style={{ gap: '0.75rem' }}>
          <label>
            Email
            <input
              type="email"
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@local.test"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="password"
            />
          </label>
          {err && <div className="error" style={{ color: 'var(--danger)' }}>{err}</div>}

          <div className="hint" style={{ fontSize: 12, color: 'var(--muted)' }}>
            Demo accounts:
            <ul style={{ margin: '6px 0 0 1rem' }}>
              <li>parent@local.test / <code>parent123</code></li>
              <li>adult@local.test / <code>adult123</code></li>
              <li>child@local.test / <code>child123</code></li>
            </ul>
          </div>
        </div>
        <footer className="modal-f">
          <div className="row" style={{ gap: '0.5rem' }}>
            <button onClick={onClose}>Cancel</button>
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="primary" disabled={busy} onClick={submit}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
