// Accept either VITE_API_BASE (preferred) or existing VITE_API_URL (your current setup).
function normalizeBase(raw?: string | null): string | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t) return null
  if (/\/api\/?$/.test(t)) return t.replace(/\/$/, '')
  return t.replace(/\/$/, '') + '/api'
}

const env: any = (import.meta as any).env || {}
const fromBase = normalizeBase(env.VITE_API_BASE)
const fromUrl  = normalizeBase(env.VITE_API_URL)
export const API_BASE = fromBase || fromUrl || '/api'

export async function fetchICS(url: string): Promise<string> {
  const res = await fetch(`${API_BASE}/fetch-ics?url=${encodeURIComponent(url)}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`ICS fetch failed (${res.status})`)
  return await res.text()
}
