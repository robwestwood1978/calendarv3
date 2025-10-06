import React from 'react'
import { listCalendars } from '../../state/integrations'

export default function CalendarLegend(){
  const cals = listCalendars().filter(c => c.enabled)
  if (cals.length === 0) return null
  return (
    <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
      {cals.map(c => (
        <span key={c.id} style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12 }}>
          <span style={{ width:10, height:10, borderRadius:999, background: c.color || '#64748b' }} />
          <span>{c.name}</span>
        </span>
      ))}
    </div>
  )
}
