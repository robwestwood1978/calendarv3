// frontend/src/google/oauth.ts
// OAuth 2.0 Authorization Code w/ PKCE for Google
// Supports optional client_secret (for tenants that require it).
// After successful redirect handling, navigates to '/settings' to avoid blank /oauth2/callback route.

type TokenBundle = {
  access_token: string
  refresh_token?: string
  expires_at?: number
  scope?: string
  token_type?: string
}

const LS_KEY = 'fc_google_oauth_v1'
const LS_CLIENT_ID = 'fc_google_client_id'
const LS_CLIENT_SECRET = 'fc_google_client_secret'

function nowMs() { return Date.now() }
function randomString(len = 64) {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('')
}

async function sha256Base64Url(input: string) {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  const bytes = new Uint8Array(buf)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function readClientId(): string | null {
  try {
    const fromLS = localStorage.getItem(LS_CLIENT_ID)?.trim()
    if (fromLS) return fromLS
  } catch {}
  try {
    const env: any = (import.meta as any).env || {}
    const cid = (env.VITE_GOOGLE_CLIENT_ID || env.VITE_GIS_CLIENT_ID || '').trim()
    return cid || null
  } catch { return null }
}

function readClientSecret(): string | null {
  try {
    const fromLS = localStorage.getItem(LS_CLIENT_SECRET)?.trim()
    if (fromLS) return fromLS
  } catch {}
  try {
    const env: any = (import.meta as any).env || {}
    const cs = (env.VITE_GOOGLE_CLIENT_SECRET || '').trim()
    return cs || null
  } catch { return null }
}

function readTokens(): TokenBundle | null {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null }
}
function writeTokens(t: TokenBundle | null) {
  if (!t) { localStorage.removeItem(LS_KEY); return }
  localStorage.setItem(LS_KEY, JSON.stringify(t))
}

function redirectUri(): string {
  const u = new URL(window.location.href)
  return `${u.origin}/oauth2/callback`
}

export function isSignedIn(): boolean {
  const t = readTokens()
  return !!(t && t.access_token)
}

export function getAccountKey(): string | null {
  return isSignedIn() ? 'google-default' : null
}

export function disconnect() {
  writeTokens(null)
}

export async function beginAuth(scopes: string[] = ['https://www.googleapis.com/auth/calendar']): Promise<void> {
  const client_id = readClientId()
  if (!client_id) throw new Error('Missing Google client id. Set VITE_GOOGLE_CLIENT_ID or localStorage.fc_google_client_id')
  const code_verifier = randomString(64)
  const code_challenge = await sha256Base64Url(code_verifier)
  const state = randomString(16)

  sessionStorage.setItem('google_pkce_verifier', code_verifier)
  sessionStorage.setItem('google_oauth_state', state)

  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
    code_challenge,
    code_challenge_method: 'S256',
  })

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  window.location.assign(url)
}

async function exchangeCodeForTokens(code: string, code_verifier: string): Promise<TokenBundle> {
  const client_id = readClientId()
  if (!client_id) throw new Error('Missing Google client id.')
  const client_secret = readClientSecret() // optional

  const body = new URLSearchParams({
    client_id,
    code,
    code_verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  })
  if (client_secret) body.set('client_secret', client_secret)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }
  const json: any = await res.json()
  const expires_at = json.expires_in ? (nowMs() + (json.expires_in * 1000) - 30_000) : undefined
  const bundle: TokenBundle = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at,
    scope: json.scope,
    token_type: json.token_type,
  }
  writeTokens(bundle)
  return bundle
}

async function refreshAccessToken(refresh_token: string): Promise<TokenBundle> {
  const client_id = readClientId()
  if (!client_id) throw new Error('Missing Google client id.')
  const client_secret = readClientSecret() // optional

  const body = new URLSearchParams({
    client_id,
    refresh_token,
    grant_type: 'refresh_token',
  })
  if (client_secret) body.set('client_secret', client_secret)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }
  const json: any = await res.json()
  const expires_at = json.expires_in ? (nowMs() + (json.expires_in * 1000) - 30_000) : undefined

  const prev = readTokens()
  const bundle: TokenBundle = {
    access_token: json.access_token,
    refresh_token: prev?.refresh_token || undefined,
    expires_at,
    scope: json.scope || prev?.scope,
    token_type: json.token_type || prev?.token_type,
  }
  writeTokens(bundle)
  return bundle
}

export async function getAccessToken(): Promise<string | null> {
  const t = readTokens()
  if (!t?.access_token) return null
  if (t.expires_at && nowMs() > t.expires_at) {
    if (t.refresh_token) {
      try {
        const nt = await refreshAccessToken(t.refresh_token)
        return nt.access_token
      } catch {
        writeTokens(null)
        return null
      }
    } else {
      return null
    }
  }
  return t.access_token
}

export async function maybeHandleRedirect(): Promise<boolean> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (!code && !error) return false
  const expected = sessionStorage.getItem('google_oauth_state')
  const verifier = sessionStorage.getItem('google_pkce_verifier') || ''

  // Clean URL params
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('scope')
  url.searchParams.delete('authuser')
  url.searchParams.delete('prompt')
  url.searchParams.delete('error')
  window.history.replaceState({}, '', url.toString())

  if (error) throw new Error(`OAuth error: ${error}`)
  if (!verifier || !expected || state !== expected) throw new Error('OAuth state mismatch')

  await exchangeCodeForTokens(code!, verifier)

  try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Google connected.' })) } catch {}

  // IMPORTANT: move away from /oauth2/callback route so Router renders something
  const dest = '/settings'
  if (location.pathname === '/oauth2/callback') {
    window.history.replaceState({}, '', dest)
    // If your router doesn't re-render on replaceState, force a navigation:
    setTimeout(() => { if (location.pathname !== dest) location.assign(dest) }, 0)
  }

  return true
}
export { beginAuth as startGoogleOAuth }
