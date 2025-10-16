import React from 'react'
import { featureFlags } from '../../state/featureFlags'
import { readSyncConfig, writeSyncConfig, readTokens, writeTokens } from '../../sync/core'

// IMPORTANT: these names match your existing oauth.ts (PKCE) exports
import { beginAuth, disconnect as googleDisconnect, getAccessToken } from '../../google/oauth'

const row: React.CSSProperties  = { display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }
const hint: React.CSSProperties = { fontSize:12, color:'#64748b', marginTop:6 }
const card: React.CSSProperties = { padding:12, background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8 }

function toast(msg: string) {
  try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
}

export default function GoogleConnectCard() {
  const [, force] = React.useReducer(x => x + 1, 0)
  const [connected, setConnected] = React.useState<boolean>(false)

  React.useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const token = await getAccessToken()    // your fn returns string | null
        if (on) setConnected(!!token)
      } catch {
        if (on) setConnected(false)
      }
    })()
    const rerender = () => force()
    window.addEventListener('fc:google-auth-changed', rerender)
    return () => { on = false; window.removeEventListener('fc:google-auth-changed', rerender) }
  }, [])

  const cfg = readSyncConfig()
  const gCfg = cfg.providers?.google || { enabled: false }

  async function onConnect() {
    try {
      await beginAuth(['https://www.googleapis.com/auth/calendar'])
      // browser will navigate to Google; no more code runs here
    } catch (e: any) {
      toast(`Could not start Google sign-in: ${String(e?.message || e)}`)
    }
  }

  async function onDisconnect() {
    try {
      await googleDisconnect()
    } finally {
      // also clear the incremental token so pulls restart clean
      const t = readTokens()
      if (t.google) t.google.sinceToken = null
      writeTokens(t)
      setConnected(false)
      toast('Disconnected Google.')
      force()
    }
  }

  function onEnableSync() {
    const next = {
      ...cfg,
      enabled: true,
      providers: {
        ...(cfg.providers || {}),
        google: { ...gCfg, enabled: true },
      },
    }
    writeSyncConfig(next)
    toast('Cloud sync enabled (Google).')
    force()
  }

  function onDisableSync() {
    writeSyncConfig({ ...cfg, enabled: false })
    toast('Cloud sync disabled.')
    force()
  }

  function onResetGoogleSyncToken() {
    const t = readTokens()
    if (t.google) t.google.sinceToken = null
    writeTokens(t)
    toast('Reset Google sync token.')
  }

  function onToggleTrace(e: React.ChangeEvent<HTMLInputElement>) {
    featureFlags.set({ syncTrace: !!e.currentTarget.checked })
    toast(!!e.currentTarget.checked ? 'Developer trace ON' : 'Developer trace OFF')
    force()
  }

  const traceOn = !!featureFlags.get().syncTrace

  return (
    <div style={card}>
      <div style={row}>
        <div>
          <strong>Google Calendar</strong>
          <div style={hint}>
            Status:{' '}
            {connected
              ? <span style={{color:'#16a34a'}}>Connected</span>
              : <span style={{color:'#ef4444'}}>Not connected</span>}
          </div>
        </div>
        <div style={{display:'flex', gap:8}}>
          {!connected && <button onClick={onConnect}>Connect</button>}
          {connected && <button onClick={onDisconnect}>Disconnect</button>}
        </div>
      </div>

      <div style={{marginTop:10, display:'grid', gap:8}}>
        <label style={{display:'inline-flex', alignItems:'center', gap:8}}>
          <input type="checkbox" checked={traceOn} onChange={onToggleTrace} />
          <span>Developer trace</span>
        </label>

        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <button onClick={onResetGoogleSyncToken}>Reset Google sync</button>
          {!cfg.enabled
            ? <button className="primary" onClick={onEnableSync} disabled={!connected}>Enable Sync</button>
            : <button onClick={onDisableSync}>Disable Sync</button>}
        </div>

        <p style={hint}>
          Uses your Google account to read/update events within your sync window. If you see
          <code> syncTokenWithNonDefaultOrdering</code>, press “Reset Google sync”.
        </p>
      </div>
    </div>
  )
}
