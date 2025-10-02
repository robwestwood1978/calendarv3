import React, { useEffect, useMemo, useState } from 'react'
import { featureFlags } from '../../state/featureFlags'
import {
  addCalendar, listCalendars, refreshCalendar, removeCalendar, saveCalendars,
  updateCalendar, listMembers, type ExternalCalendar
} from '../../state/integrations'
import { fetchICS } from '../../api/integrations'

const card: React.CSSProperties = { padding: 12, background: 'var(--panel,#fff)', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }
const row: React.CSSProperties  = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
const small: React.CSSProperties = { fontSize: 12, opacity: 0.7 }

export default function IntegrationsPanel(){
  const [flags, setFlags] = useState(() => featureFlags.get())
  const [cals, setCals] = useState<ExternalCalendar[]>(listCalendars())
  const [name, setName] = useState('Apple Family')
  const [url, setUrl] = useState('')
  const [provider, setProvider] = useState<'apple'|'ics'>('apple')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const members = useMemo(() => listMembers(), [])
  useEffect(() => featureFlags.subscribe(() => setFlags(featureFlags.get())), [])

  function toggleMaster(e: React.ChangeEvent<HTMLInputElement>){
    featureFlags.set({ integrations: e.currentTarget.checked })
  }

  function onAdd(e: React.FormEvent){
    e.preventDefault()
    if (!url.trim()) { setError('Please paste an ICS URL'); return }
    addCalendar({ name: name.trim() || 'External', url: url.trim(), provider, color: undefined, enabled: true })
    setCals(listCalendars()); setUrl(''); setName(provider === 'apple' ? 'Apple Family' : 'External ICS'); setProvider('apple'); setError(null)
  }

  async function onRefresh(cal: ExternalCalendar){
    try { setBusy(cal.id); setError(null); const count = await refreshCalendar(cal, fetchICS); setCals(listCalendars()); alert(`Synced ${count} events from ${cal.name}`) }
    catch (err: any) { setError(err?.message || String(err)) }
    finally { setBusy(null) }
  }

  function onToggleEnabled(cal: ExternalCalendar){
    const next = cals.map(c => c.id === cal.id ? { ...c, enabled: !c.enabled } : c)
    saveCalendars(next); setCals(next)
  }

  function onRemove(cal: ExternalCalendar){
    if (!confirm(`Remove ${cal.name}?`)) return
    removeCalendar(cal.id); setCals(listCalendars())
  }

  function onToggleMember(cal: ExternalCalendar, memberId: string){
    const set = new Set(cal.assignedMemberIds || [])
    set.has(memberId) ? set.delete(memberId) : set.add(memberId)
    updateCalendar(cal.id, { assignedMemberIds: Array.from(set) })
    setCals(listCalendars())
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
          <form onSubmit={onAdd} style={{ display:'grid', gap:8, marginTop:12 }}>
            <div style={row}>
              <label style={{ minWidth:120 }}>Provider</label>
              <select value={provider} onChange={e => setProvider(e.currentTarget.value as any)}>
                <option value="apple">Apple (ICS)</option>
                <option value="ics">Generic ICS</option>
              </select>
            </div>
            <div style={row}>
              <label style={{ minWidth:120 }}>Name</label>
              <input value={name} onChange={e=>setName(e.currentTarget.value)} placeholder="e.g. Family" />
            </div>
            <div style={row}>
              <label style={{ minWidth:120 }}>ICS URL</label>
              <input value={url} onChange={e=>setUrl(e.currentTarget.value)} placeholder="webcal:// or https://…" style={{ flex:1 }} />
            </div>
            <div><button type="submit">Add calendar</button></div>
            {error && <div style={{ color:'crimson', fontSize:12 }}>{error}</div>}
          </form>

          <div style={{ marginTop:16 }}>
            <h4 style={{ margin: '12px 0 6px' }}>Connected calendars</h4>
            {cals.length === 0 && <p style={small}>No calendars yet.</p>}
            {cals.map(cal => (
              <div key={cal.id} style={{ padding:'8px 0', borderTop:'1px solid #e5e7eb', display:'grid', gap:6 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                  <div style={{ display:'grid' }}>
                    <strong>{cal.name}</strong>
                    <span style={small}>{cal.provider.toUpperCase()} · {cal.url.slice(0,60)}{cal.url.length>60?'…':''}</span>
                    {cal.lastSyncISO && <span style={small}>Last sync: {new Date(cal.lastSyncISO).toLocaleString()}</span>}
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <label style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                      <input type="checkbox" checked={cal.enabled} onChange={() => onToggleEnabled(cal)} />
                      <span style={small}>Enabled</span>
                    </label>
                    <button onClick={() => onRefresh(cal)} disabled={busy===cal.id}>{busy===cal.id?'Syncing…':'Refresh'}</button>
                    <button onClick={() => onRemove(cal)} disabled={busy!=null} style={{ color:'crimson' }}>Remove</button>
                  </div>
                </div>

                {/* Member mapping chips */}
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {members.length === 0 && <span style={small}>No members found. Add household members in Settings first.</span>}
                  {members.map(m => {
                    const on = (cal.assignedMemberIds || []).includes(m.id)
                    return (
                      <label key={m.id} style={chip(on)}>
                        <input type="checkbox" checked={on} onChange={() => onToggleMember(cal, m.id)} />
                        <span>{m.name}</span>
                      </label>
                    )
                  })}
                </div>
                <div style={{ ...small, marginTop: -2 }}>
                  These members will see this calendar’s events when “My Agenda” is ON.
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function chip(on:boolean): React.CSSProperties {
  return { display:'inline-flex', gap:6, alignItems:'center', padding:'6px 10px', borderRadius: 999, border:'1px solid #e5e7eb', background: on?'#e6f0ff':'#fff' }
}
