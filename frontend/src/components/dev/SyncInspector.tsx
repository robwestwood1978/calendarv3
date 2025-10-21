// frontend/src/components/dev/SyncInspector.tsx
import React from 'react'
import { diag } from '../../sync/diag'

export default function SyncInspector() {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [rows, setRows] = React.useState(() => diag.dump())

  React.useEffect(() => {
    const h = () => setRows(diag.dump())
    const i = setInterval(h, 800) // poll — low effort and safe
    const openH = () => setOpen(true)
    window.addEventListener('fc:open-sync-inspector' as any, openH)
    return () => { clearInterval(i); window.removeEventListener('fc:open-sync-inspector' as any, openH) }
  }, [])

  const filtered = React.useMemo(() => {
    if (!q) return rows
    return rows.filter(r =>
      (r.localId && r.localId.includes(q)) ||
      (r.externalId && r.externalId.includes(q)) ||
      (r.kind && r.kind.toLowerCase().includes(q.toLowerCase())) ||
      (r.msg && r.msg.toLowerCase().includes(q.toLowerCase()))
    )
  }, [rows, q])

  if (!open) return null

  return (
    <div style={wrap}>
      <div style={head}>
        <strong>Sync Inspector</strong>
        <input placeholder="filter id / message…" value={q} onChange={e => setQ(e.currentTarget.value)} style={filter} />
        <button onClick={() => setOpen(false)}>Close</button>
      </div>
      <div style={body}>
        {filtered.map((r, i) => (
          <div key={i} style={row}>
            <div style={ts}>{new Date(r.ts).toLocaleTimeString()}</div>
            <div style={pill(r.phase)}>{r.phase}</div>
            <div style={pill2}>{r.kind}</div>
            <div style={{ minWidth: 90 }}>{r.provider || ''}</div>
            <div title={r.localId || ''} style={mono}>{r.localId || ''}</div>
            <div title={r.externalId || ''} style={mono}>{r.externalId || ''}</div>
            <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.msg || ''}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = { position:'fixed', right: 12, bottom: 58, width: 780, maxHeight: '70vh', background:'#fff', border:'1px solid #e5e7eb', borderRadius: 12, boxShadow:'0 12px 40px rgba(0,0,0,.15)', display:'flex', flexDirection:'column', zIndex: 9999 }
const head: React.CSSProperties = { display:'flex', alignItems:'center', gap:8, padding:8, borderBottom:'1px solid #e5e7eb', background:'#f8fafc' }
const body: React.CSSProperties = { overflow:'auto', maxHeight:'calc(70vh - 42px)' }
const row: React.CSSProperties = { display:'grid', gridTemplateColumns:'86px 70px 160px 90px 1fr 1fr 2fr', gap:8, alignItems:'center', padding:'6px 8px', borderBottom:'1px solid #f1f5f9', fontSize:12 }
const ts: React.CSSProperties = { opacity:.7 }
const mono: React.CSSProperties = { fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }
const filter: React.CSSProperties = { flex:1, padding:'6px 8px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }
const pill = (p: string): React.CSSProperties => ({ fontSize:11, padding:'2px 6px', borderRadius:999, background: p==='error' ? '#fee2e2' : '#e5e7eb' })
const pill2: React.CSSProperties = { fontSize:11, padding:'2px 6px', borderRadius:6, background:'#eef2ff' }
