// frontend/src/auth/AuthProvider.tsx
// Offline-first local auth (email + password hashed with SHA-256).
// Seeds three users for dev. Fully gated by feature flag (authEnabled).
// Storage keys: fc_users_v1, fc_current_user_v1

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { featureFlags } from '../state/featureFlags'
import { useSettings } from '../state/settings'

export type UserRole = 'parent' | 'adult' | 'child'
export type User = {
  id: string
  email: string
  displayName?: string
  role: UserRole
  passwordHash: string
  linkedMemberIds: string[]
}

type AuthCtx = {
  currentUser: User | null
  users: User[]
  signIn: (email: string, password: string) => Promise<boolean>
  signOut: () => void
  linkMember: (memberId: string) => void
  unlinkMember: (memberId: string) => void
  isParent: boolean
  isAdult: boolean
  isChild: boolean
}

const AuthContext = createContext<AuthCtx | null>(null)

const LS_USERS = 'fc_users_v1'
const LS_CURRENT = 'fc_current_user_v1'

const seeds: Array<{ email: string; password: string; role: UserRole }> = [
  { email: 'parent@local.test', password: 'parent123', role: 'parent' },
  { email: 'adult@local.test',  password: 'adult123',  role: 'adult'  },
  { email: 'child@local.test',  password: 'child123',  role: 'child'  },
]

function uid() { return `u_${Date.now()}_${Math.random().toString(36).slice(2)}` }

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  const bytes = Array.from(new Uint8Array(buf))
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

function loadUsers(): User[] {
  try {
    const raw = localStorage.getItem(LS_USERS)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function saveUsers(users: User[]) {
  localStorage.setItem(LS_USERS, JSON.stringify(users))
  try { window.dispatchEvent(new CustomEvent('fc:users:changed')) } catch {}
}
function loadCurrentId(): string | null {
  try { return localStorage.getItem(LS_CURRENT) } catch { return null }
}
function saveCurrentId(id: string | null) {
  if (id) localStorage.setItem(LS_CURRENT, id)
  else localStorage.removeItem(LS_CURRENT)
  try { window.dispatchEvent(new CustomEvent('fc:users:changed')) } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>(() => loadUsers())
  const [currentId, setCurrentId] = useState<string | null>(() => loadCurrentId())

  // Watch cross-tab changes
  useEffect(() => {
    const h = () => { setUsers(loadUsers()); setCurrentId(loadCurrentId()) }
    window.addEventListener('storage', h)
    window.addEventListener('fc:users:changed', h)
    return () => { window.removeEventListener('storage', h); window.removeEventListener('fc:users:changed', h) }
  }, [])

  // Seed only if flag ON and no users exist
  useEffect(() => {
    const { authEnabled } = featureFlags.get()
    if (!authEnabled) return
    if (loadUsers().length > 0) return
    ;(async () => {
      const seeded: User[] = []
      for (const s of seeds) {
        const hash = await sha256Hex(`${s.email.toLowerCase()}|${s.password}`)
        seeded.push({ id: uid(), email: s.email.toLowerCase(), role: s.role, passwordHash: hash, linkedMemberIds: [] })
      }
      saveUsers(seeded)
      setUsers(seeded)
    })()
  }, [])

  const currentUser = useMemo(() => users.find(u => u.id === currentId) || null, [users, currentId])

  async function signIn(email: string, password: string): Promise<boolean> {
    const { authEnabled } = featureFlags.get()
    if (!authEnabled) return false
    const e = email.trim().toLowerCase()
    const hash = await sha256Hex(`${e}|${password}`)
    const u = loadUsers().find(x => x.email === e && x.passwordHash === hash) || null
    if (!u) return false
    saveCurrentId(u.id)
    setCurrentId(u.id)
    return true
  }
  function signOut() {
    saveCurrentId(null)
    setCurrentId(null)
  }

  function updateUser(u: User) {
    const next = loadUsers().map(x => x.id === u.id ? u : x)
    saveUsers(next)
    setUsers(next)
  }

  function linkMember(memberId: string) {
    if (!currentUser) return
    if (currentUser.linkedMemberIds.includes(memberId)) return
    updateUser({ ...currentUser, linkedMemberIds: [...currentUser.linkedMemberIds, memberId] })
  }
  function unlinkMember(memberId: string) {
    if (!currentUser) return
    updateUser({ ...currentUser, linkedMemberIds: currentUser.linkedMemberIds.filter(id => id !== memberId) })
  }

  const value: AuthCtx = {
    currentUser,
    users,
    signIn,
    signOut,
    linkMember,
    unlinkMember,
    isParent: currentUser?.role === 'parent',
    isAdult: currentUser?.role === 'adult',
    isChild: currentUser?.role === 'child',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext) || {
    currentUser: null,
    users: [],
    signIn: async () => false,
    signOut: () => {},
    linkMember: () => {},
    unlinkMember: () => {},
    isParent: false, isAdult: false, isChild: false,
  } as AuthCtx
}
