// frontend/src/auth/AuthProvider.tsx
// Slice C Auth provider with a built-in Sign In dialog trigger.
// - Stores users in localStorage (hashed passwords, SHA-256).
// - Seeds three users if none exist (parent/adult/child).
// - Exposes signIn()/signOut() and link/unlink members.
// - Only active when feature flag authEnabled=true.
// - Renders a SignInDialog when signIn() is called.

import React from 'react'
import SignInDialog from '../components/SignInDialog'

type UserRole = 'parent' | 'adult' | 'child'

export type AuthUser = {
  id: string
  email: string
  role: UserRole
  linkedMemberIds: string[]
}

type Ctx = {
  currentUser: AuthUser | null
  users: AuthUser[]
  signIn: () => void
  signOut: () => void
  linkMember: (memberId: string) => void
  unlinkMember: (memberId: string) => void
  isEnabled: boolean
}

const AuthCtx = React.createContext<Ctx | null>(null)

const LS_FLAGS   = 'fc_feature_flags_v1'
const LS_USERS   = 'fc_users_v1'
const LS_CURRENT = 'fc_current_user_v1'

function readFlags(): { authEnabled?: boolean } {
  try { return JSON.parse(localStorage.getItem(LS_FLAGS) || '{}') } catch { return {} }
}
function readUsers(): AuthUser[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_USERS) || '[]')
    if (Array.isArray(arr)) return arr
  } catch {}
  return []
}
function writeUsers(u: AuthUser[]) {
  localStorage.setItem(LS_USERS, JSON.stringify(u))
  try { window.dispatchEvent(new CustomEvent('fc:users:changed')) } catch {}
}
function readCurrentId(): string | null {
  return localStorage.getItem(LS_CURRENT)
}
function writeCurrentId(id: string | null) {
  if (id) localStorage.setItem(LS_CURRENT, id)
  else localStorage.removeItem(LS_CURRENT)
  try { window.dispatchEvent(new CustomEvent('fc:users:changed')) } catch {}
}

async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  const arr = Array.from(new Uint8Array(buf))
  return arr.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Seed three users on empty store (idempotent).
async function ensureSeedUsers() {
  const users = readUsers()
  if (users.length > 0) return
  const seed: (Omit<AuthUser, 'linkedMemberIds'> & { passwordHash: string; linkedMemberIds: string[] })[] = [
    { id: `u_${Date.now()}_p`, email: 'parent@local.test', role: 'parent', passwordHash: await sha256('parent123'), linkedMemberIds: [] },
    { id: `u_${Date.now()}_a`, email: 'adult@local.test',  role: 'adult',  passwordHash: await sha256('adult123'),  linkedMemberIds: [] },
    { id: `u_${Date.now()}_c`, email: 'child@local.test',  role: 'child',  passwordHash: await sha256('child123'),  linkedMemberIds: [] },
  ]
  // Store only the fields we read back (email, role, id, linkedMemberIds) + passwordHash for verification
  localStorage.setItem(LS_USERS, JSON.stringify(seed))
}

function isAuthEnabled(): boolean {
  return !!readFlags().authEnabled
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = React.useState(isAuthEnabled())
  const [, force] = React.useState(0)
  const [showDialog, setShowDialog] = React.useState(false)
  const [current, setCurrent] = React.useState<AuthUser | null>(null)
  const [users, setUsers] = React.useState<AuthUser[]>([])

  // React to flag toggles from Settings
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e && e.key === LS_FLAGS) setEnabled(isAuthEnabled())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Boot: if enabled, seed users and load state
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!enabled) { setUsers([]); setCurrent(null); return }
      await ensureSeedUsers()

      // Load current users snapshot
      const raw = localStorage.getItem(LS_USERS)
      let list: any[] = []
      try { list = JSON.parse(raw || '[]') } catch {}
      // Normalize to AuthUser for context consumers (we keep passwordHash in storage only)
      const norm: AuthUser[] = list.map(u => ({
        id: u.id, email: u.email, role: u.role, linkedMemberIds: Array.isArray(u.linkedMemberIds) ? u.linkedMemberIds : []
      }))
      if (!cancelled) setUsers(norm)

      const cid = readCurrentId()
      if (cid) {
        const found = norm.find(u => u.id === cid) || null
        if (!cancelled) setCurrent(found)
      } else {
        if (!cancelled) setCurrent(null)
      }
    })()
    return () => { cancelled = true }
  }, [enabled, force])

  // Public API
  const signIn = () => {
    if (!enabled) return
    setShowDialog(true)
  }
  const signOut = () => {
    writeCurrentId(null)
    setCurrent(null)
    setShowDialog(false)
  }

  const linkMember = (memberId: string) => {
    if (!current) return
    const raw = localStorage.getItem(LS_USERS)
    let list: any[] = []
    try { list = JSON.parse(raw || '[]') } catch {}
    const idx = list.findIndex(u => u && u.id === current.id)
    if (idx >= 0) {
      const prevIds: string[] = Array.isArray(list[idx].linkedMemberIds) ? list[idx].linkedMemberIds : []
      if (!prevIds.includes(memberId)) prevIds.push(memberId)
      list[idx].linkedMemberIds = prevIds
      localStorage.setItem(LS_USERS, JSON.stringify(list))
      setUsers(list.map(u => ({ id: u.id, email: u.email, role: u.role, linkedMemberIds: u.linkedMemberIds || [] })))
      setCurrent({ ...current, linkedMemberIds: prevIds })
      try { window.dispatchEvent(new CustomEvent('fc:users:changed')) } catch {}
    }
  }

  const unlinkMember = (memberId: string) => {
    if (!current) return
    const raw = localStorage.getItem(LS_USERS)
    let list: any[] = []
    try { list = JSON.parse(raw || '[]') } catch {}
    const idx = list.findIndex(u => u && u.id === current.id)
    if (idx >= 0) {
      const prevIds: string[] = Array.isArray(list[idx].linkedMemberIds) ? list[idx].linkedMemberIds : []
      const nextIds = prevIds.filter((x: string) => x !== memberId)
      list[idx].linkedMemberIds = nextIds
      localStorage.setItem(LS_USERS, JSON.stringify(list))
      setUsers(list.map(u => ({ id: u.id, email: u.email, role: u.role, linkedMemberIds: u.linkedMemberIds || [] })))
      setCurrent({ ...current, linkedMemberIds: nextIds })
      try { window.dispatchEvent(new CustomEvent('fc:users:changed')) } catch {}
    }
  }

  const value: Ctx = {
    currentUser: current,
    users,
    signIn,
    signOut,
    linkMember,
    unlinkMember,
    isEnabled: enabled,
  }

  // Listen for external user changes (other tabs/settings)
  React.useEffect(() => {
    const onChange = () => force(x => x + 1)
    window.addEventListener('fc:users:changed', onChange as any)
    return () => window.removeEventListener('fc:users:changed', onChange as any)
  }, [])

  // Verify credentials when dialog submits
  const handleSubmit = async (email: string, password: string) => {
    try {
      const listRaw = localStorage.getItem(LS_USERS)
      const list: any[] = listRaw ? JSON.parse(listRaw) : []
      const user = list.find(u => u && u.email === email)
      if (!user) return { ok: false, message: 'Unknown email' }
      const hash = await sha256(password)
      if (user.passwordHash !== hash) return { ok: false, message: 'Incorrect password' }

      writeCurrentId(user.id)
      setCurrent({ id: user.id, email: user.email, role: user.role, linkedMemberIds: user.linkedMemberIds || [] })
      setShowDialog(false)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: 'Sign in failed' }
    }
  }

  return (
    <AuthCtx.Provider value={value}>
      {children}
      {/* Modal lives inside provider so AccountMenu.signIn() always opens it */}
      {enabled && (
        <SignInDialog
          open={showDialog}
          onClose={() => setShowDialog(false)}
          onSubmit={handleSubmit}
        />
      )}
    </AuthCtx.Provider>
  )
}

export function useAuth(): Ctx {
  const ctx = React.useContext(AuthCtx)
  if (!ctx) {
    // Provide a no-op fallback so non-auth builds don’t crash.
    return {
      currentUser: null,
      users: [],
      signIn: () => {},
      signOut: () => {},
      linkMember: () => {},
      unlinkMember: () => {},
      isEnabled: false,
    }
  }
  return ctx
}
