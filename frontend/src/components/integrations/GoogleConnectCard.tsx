import React from 'react'
import { readSyncConfig, writeSyncConfig, readTokens, writeTokens } from '../../sync/core'
import { startGoogleOAuth as beginAuth, getAccessToken, disconnect as revokeGoogle } from '../../google/oauth'

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }
const small: React.CSSProperties = { fontSize: 12, opacity: .75 }

export default function GoogleConnectCard() {
  const [connected, setConnected] = React.useState<boolean>(false)
  const [calendars, setCalendars] = React.useState<{id:string; summary:string; primary?:boolean}[]>([])
  const [sel, setSel] = React.useState<string>('primary')
  const [trace, setTrace] = React.useState<boolean>(() => localStorage.getItem('fc_sync_trace') === '1')

  React.useEffect(() => {
    (async () => {
      const tok = await getAccessToken()
      setConnected(!!tok)
      if (!tok) return
      try {
        const r = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
          headers: { Authorization: `Bearer ${tok}` }
        })
        if (!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        const items = (j.items || []).map((x:any)=>({ id:x.id, summary:x.summary || x.id, primary: !!x.primary }))
        setCalendars(items)
        const cfg = readSyncConfig()
        const current = cfg?.providers?.google?.calendars?.[0] || items.find(x=>x.primary)?.id || 'primary'
        setSel(current)
      } catch (e) {
        console.warn('list calendars failed', e)
      }
    })()
  }, [])

  function onConnect() {
    beginAuth().catch(err => alert(String(err?.message || err)))
  }

  function onDisconnect() {
    try { revokeGoogle() } catch {}
    writeTokens({ google: { sinceToken: null } } as any)
    const cfg = readSyncConfig()
    writeSyncConfig({
      ...cfg,
      enabled: false,
      providers: { ...cfg.providers, google: { enabled: false, calendars: [] } }
    })
    setConnected(false)
    alert('Disconnected Google.')
  }

  function onSaveCalendar(id: string) {
    const cfg = readSyncConfig()
    writeSyncConfig({
      ...cfg,
      enabled: true,
      providers: {
        ...cfg.providers,
        google: {
          enabled: true,
          accountKey: 'google-default',
          calendars: [id],
        },
      },
    })
    setSel(id)
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Google calendar saved.' })) } catch {}
  }

  function onResetSync() {
    const tokens = readTokens()
    const next = { ...(tokens || {}) }
    if (!next['google']) next['google'] = { sinceToken: null }
    next['google'].sinceToken = null
    writeTokens(next as any)
    try { window.dispatchEvent(new CustomEvent('toast', { detail: 'Google sync reset.' })) } catch {}
  }

  function onToggleTrace(on: boolean) {
    setTrace(on)
    if (on) localStorage.setItem('fc_sync_trace', '1')
    else localStorage.removeItem('fc_sync_trace')
  }

  return (
    <div style={{ display:'grid', gap:10 }}>
      <div style={row}>
        <strong>Status:</strong>
        <span>{connected ? 'Connected' : 'Not connected'}</span>
      </div>

      {!connected ? (
        <div><button className="primary" onClick={onConnect}>Connect Google</button></div>
      ) : (
        <>
          <div style={row}>
            <label>Calendar</label>
            <select value={sel} onChange={e => onSaveCalendar(e.currentTarget.value)}>
              {calendars.map(c => <option key={c.id} value={c.id}>{c.summary}{c.primary?' (primary)':''}</option>)}
              {calendars.length===0 && <option value="primary">primary</option>}
            </select>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onResetSync}>Reset Google sync</button>
            <button onClick={onDisconnect} style={{ color:'crimson' }}>Disconnect</button>
          </div>

          <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
            <input type="checkbox" checked={trace} onChange={e => onToggleTrace(e.currentTarget.checked)} />
            <span>Developer trace</span>
          </label>
          <p style={small}>Writes extra sync output to console. Use “Reset Google sync” if you ever see syncToken errors or stale data.</p>
        </>
      )}
    </div>
  )
}
