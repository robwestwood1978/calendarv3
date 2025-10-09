// frontend/src/google/oauth.ts
// Browser-only OAuth 2.0 Authorization Code Flow with PKCE for Google (GIS compatible).
// - No secrets stored; uses PKCE (code_verifier/code_challenge).
// - Stores tokens in localStorage under fc_google_oauth_v1.
// - Refreshes token when expired (requires 'access_type=offline' and first consent).
//
// Configure a Google OAuth client as a "Web application" and add:
//   - Authorized JavaScript origin: https://<your-domain>
//   - Authorized redirect URI:     https://<your-domain>/oauth2/callback
// Then set VITE_GOOGLE_CLIENT_ID (or override via localStorage key fc_google_client_id).

type TokenBundle = {
  access_token: string
  refresh_token?: string
  expires_at?: number        // epoch millis when access token expires
  scope?: string
  token_type?: string
}

const LS_KEY = 'fc_google_oauth_v1'
const LS_CLIENT_ID = 'fc_google_client_id'

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
  // A stable label for the signed-in Google account (opaque for now)
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

  const body = new URLSearchParams({
    client_id,
    code,
    code_verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`)
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

  const body = new URLSearchParams({
    client_id,
    refresh_token,
    grant_type: 'refresh_token',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`)
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
      // No refresh token; require interactive re-auth
      return null
    }
  }
  return t.access_token
}

// Call this very early (e.g., in main.tsx before rendering) to catch redirect.
export async function maybeHandleRedirect(): Promise<boolean> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (!code && !error) return false
  const expected = sessionStorage.getItem('google_oauth_state')
  const verifier = sessionStorage.getItem('google_pkce_verifier') || ''

  // Always clean up URL
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
  // Send a friendly toast if you have one
  try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Google connected.' })) } catch {}
  return true
}
