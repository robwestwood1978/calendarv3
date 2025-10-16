// frontend/src/components/integrations/IntegrationsPanel.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { featureFlags } from '../../state/featureFlags'
import {
  addCalendar,
  listCalendars,
  refreshCalendar,
  removeCalendar,
  saveCalendars,
  updateCalendar,
  listMembers,
  type ExternalCalendar,
} from '../../state/integrations'

const card: React.CSSProperties = {
  padding: 12,
  background: 'var(--panel,#fff)',
  borderRadius: 12,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
}
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
const small: React.CSSProperties = { fontSize: 12, opacity: 0.75 }

function validateUrl(u: string): { ok: boolean; hint?: string } {
  const raw = u.trim()
  if (!raw) return { ok: false, hint: 'Please paste an ICS URL.' }
  const norm = raw.replace(/^webcal:/i, 'https:')
  let parsed: URL
  try {
    parsed = new URL(norm)
  } catch {
    return { ok: false, hint: 'Invalid URL. Use webcal:// or https:// to a public ICS.' }
  }
  const host = parsed.hostname.toLowerCase()
  const allow = [
    'icloud.com',
    'apple.com',
    'google.com',
    'calendar.google.com',
    'googleusercontent.com',
    'outlook.com',
    'outlook.office365.com',
    'office365.com',
    'office.com',
    'live.com',
    'yahoo.com',
    'calendar.yahoo.com',
    'teamup.com',
    'ics.teamup.com',
  ]
  const allowed = allow.some((sfx) => host === sfx || host.endsWith(`.${sfx}`))
  if (!allowed) return { ok: false, hint: `Host "${host}" not in allow-list.` }
  return { ok: true }
}

export default function IntegrationsPanel() {
  const [flags, setFlags] = useState(() => featureFlags.get())
  const [cals, setCals] = useState<ExternalCalendar[]>(listCalendars())
  const [name, setName] = useState('Apple Family')
  const [url, setUrl] = useState('')
  const [provider, setProvider] = useState<'apple' | 'ics' | 'google'>('apple')
  const [color, setColor] = useState('#3b82f6')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const members = useMemo(() => listMembers(), [])
  useEffect(() => featureFlags.subscribe(() => setFlags(featureFlags.get())), [])

  function toggleMaster(e: React.ChangeEvent<HTMLInputElement>) {
    featureFlags.set({ integrations: e.currentTarget.checked })
  }

  function onPreflight(input: string) {
    const v = validateUrl(input)
    setHint(v.ok ? null : v.hint || null)
    return v.ok
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault()
    const ok = onPreflight(url)
    if (!ok) return
    const normalized = url.trim().replace(/^webcal:/i, 'https:')
    addCalendar({
      name: name.trim() || 'External',
      url: normalized,
      provider: provider === 'google' ? 'ics' : provider,
      color,
      enabled: true,
    })
    setCals(listCalendars())
    setUrl('')
    setName(provider === 'apple' ? 'Apple Family' : 'External ICS')
    setProvider('apple')
    setError(null)
    setHint(null)
  }

  async function onRefresh(cal: ExternalCalendar) {
    try {
      setBusy(cal.id)
      setError(null)
      const count = await refreshCalendar(cal)
      setCals(listCalendars())
      alert(`Synced ${count} ${count === 1 ? 'event' : 'events'} from ${cal.name}`)
    } catch (err: any) {
      const msg = String(err?.message || err || '')
      const friendly = /403|401/i.test(msg)
        ? 'This iCloud calendar looks private. In Apple Calendar: Info → tick “Public Calendar”, then paste the public link.'
        : /host.+allow/i.test(msg)
        ? 'This calendar host is not supported by the proxy allow-list.'
        : /timeout|502/i.test(msg)
        ? 'Upstream timed out. Try again in a moment.'
        : null
      setError(friendly ? `${friendly}\n\nDetails: ${msg}` : msg)
    } finally {
      setBusy(null)
    }
  }

  function onToggleEnabled(cal: ExternalCalendar) {
    const next = cals.map((c) => (c.id === cal.id ? { ...c, enabled: !c.enabled } : c))
    saveCalendars(next)
    setCals(next)
  }

  function onAllowEditLocal(cal: ExternalCalendar) {
    updateCalendar(cal.id, { allowEditLocal: !cal.allowEditLocal })
    setCals(listCalendars())
  }

  function onRemove(cal: ExternalCalendar) {
    if (!confirm(`Remove ${cal.name}?`)) return
    removeCalendar(cal.id)
    setCals(listCalendars())
  }

  function onToggleMember(cal: ExternalCalendar, memberId: string) {
    const set = new Set(cal.assignedMemberIds || [])
    set.has(memberId) ? set.delete(memberId) : set.add(memberId)
    updateCalendar(cal.id, { assignedMemberIds: Array.from(set) })
    setCals(listCalendars())
  }

  function onColorChange(cal: ExternalCalendar, val: string) {
    updateCalendar(cal.id, { color: val })
    setCals(listCalendars())
    try {
      window.dispatchEvent(new Event('fc:events-changed'))
    } catch {}
  }

  return (
    <section style={card}>
      <h3>Integrations</h3>
      <label style={row}>
        <span>Enable integrations (master)</span>
        <input type="checkbox" checked={!!flags.integrations} onChange={toggleMaster} />
      </label>

      {!flags.integrations && <p style={small}>Turn on to see Apple/ICS options.</p>}

      {flags.integrations && (
        <>
          <form onSubmit={onAdd} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <div style={row}>
              <label style={{ minWidth: 120 }}>Provider</label>
              <select value={provider} onChange={(e) => setProvider(e.currentTarget.value as any)}>
                <option value="apple">Apple (ICS)</option>
                <option value="google">Google (public ICS)</option>
                <option value="ics">Generic ICS</option>
              </select>
            </div>
            <div style={row}>
              <label style={{ minWidth: 120 }}>Name</label>
              <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Family" />
            </div>
            <div style={row}>
              <label style={{ minWidth: 120 }}>Colour</label>
              <input type="color" value={color} onChange={(e) => setColor(e.currentTarget.value)} />
            </div>
            <div style={row}>
              <label style={{ minWidth: 120 }}>ICS URL</label>
              <input
                value={url}
                onChange={(e) => {
                  setUrl(e.currentTarget.value)
                  onPreflight(e.currentTarget.value)
                }}
                placeholder="webcal:// or https://…" style={{ flex: 1 }}
              />
            </div>
            {hint && <div style={{ color: '#b45309', fontSize: 12, whiteSpace: 'pre-wrap' }}>{hint}</div>}
            <div>
              <button type="submit">Add calendar</button>
            </div>
            {error && <div style={{ color: 'crimson', fontSize: 12, whiteSpace: 'pre-wrap' }}>{error}</div>}
          </form>

          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: '12px 0 6px' }}>Connected calendars</h4>
            {cals.length === 0 && <p style={small}>No calendars yet.</p>}
            {cals.map((cal) => (
              <div key={cal.id} style={{ padding: '8px 0', borderTop: '1px solid #e5e7eb', display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'grid' }}>
                    <strong>{cal.name}</strong>
                    <span style={small}>
                      {cal.provider.toUpperCase()} · {cal.url.slice(0, 60)}
                      {cal.url.length > 60 ? '…' : ''}
                    </span>
                    <span style={small}>Last sync: {cal.lastSyncISO ? new Date(cal.lastSyncISO).toLocaleString() : 'never'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={small}>Colour</span>
                      <input type="color" value={cal.color || '#64748b'} onChange={(e) => onColorChange(cal, e.currentTarget.value)} />
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={!!cal.allowEditLocal} onChange={() => onAllowEditLocal(cal)} />
                      <span style={small}>Allow editing (local)</span>
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={cal.enabled} onChange={() => onToggleEnabled(cal)} />
                      <span style={small}>Enabled</span>
                    </label>
                    <button onClick={() => onRefresh(cal)} disabled={busy === cal.id}>
                      {busy === cal.id ? 'Syncing…' : 'Refresh'}
                    </button>
                    <button onClick={() => onRemove(cal)} disabled={busy != null} style={{ color: 'crimson' }}>
                      Remove
                    </button>
                  </div>
                </div>

                {/* Member mapping chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {members.length === 0 && <span style={small}>No members found. Add household members in Settings first.</span>}
                  {members.map((m) => {
                    const on = (cal.assignedMemberIds || []).includes(m.id)
                    return (
                      <label key={m.id} style={chip(on)}>
                        <input type="checkbox" checked={on} onChange={() => onToggleMember(cal, m.id)} />
                        <span>{m.name}</span>
                      </label>
                    )
                  })}
                </div>
                <div style={{ ...small, marginTop: -2 }}>These members will see this calendar’s events when “My Agenda” is ON.</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function chip(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    gap: 6,
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: on ? '#e6f0ff' : '#fff',
  }
}
