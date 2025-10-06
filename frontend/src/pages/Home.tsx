import React, { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { listExpanded } from '../state/events-agenda'
import type { EventRecord } from '../lib/recurrence'
import { useSettings, fmt } from '../state/settings'
import { Link, useNavigate } from 'react-router-dom'
import { calendarMetaFor } from '../lib/external'

export default function Home() {
  const s = useSettings()
  const nav = useNavigate()
  const [query, setQuery] = useState('')

  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion(v => v + 1)
    window.addEventListener('fc:events-changed', bump)
    window.addEventListener('fc:my-agenda:changed', bump)
    window.addEventListener('fc:integrations:changed', bump)
    window.addEventListener('fc:users:changed', bump)
    window.addEventListener('fc:settings:changed', bump)
    window.addEventListener('fc:flags:changed', bump)
    return () => {
      window.removeEventListener('fc:events-changed', bump)
      window.removeEventListener('fc:my-agenda:changed', bump)
      window.removeEventListener('fc:integrations:changed', bump)
      window.removeEventListener('fc:users:changed', bump)
      window.removeEventListener('fc:settings:changed', bump)
      window.removeEventListener('fc:flags:changed', bump)
    }
  }, [])

  const start = DateTime.local().startOf('day')
  const end = start.plus({ days: 7 }).endOf('day')
  const now = DateTime.local()

  const events = useMemo(() => {
    const data = listExpanded(start, end, query)
    return data.filter(e => {
      const st = DateTime.fromISO(e.start)
      const en = DateTime.fromISO(e.end)
      return st.isValid && en.isValid && en >= now
    }).sort((a,b) => a.start.localeCompare(b.start))
  }, [start.toISO(), end.toISO(), query, version])

  const happeningNow = events.filter(e => {
    const st = DateTime.fromISO(e.start), en = DateTime.fromISO(e.end)
    return st <= now && en >= now
  })
  const laterToday = events.filter(e => {
    const st = DateTime.fromISO(e.start)
    return st > now && st.toISODate() === now.toISODate()
  })
  const restOfWeek = events.filter(e => {
    const st = DateTime.fromISO(e.start)
    return st.toISODate() !== now.toISODate()
  })

  const byDay = useMemo(() => {
    const map = new Map<string, EventRecord[]>()
    for (const e of restOfWeek) {
      const key = DateTime.fromISO(e.start).toISODate()!
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    for (const [, arr] of map) arr.sort((a,b) => a.start.localeCompare(b.start))
    return Array.from(map.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([k, items]) => ({
      day: DateTime.fromISO(`${k}T00:00:00`), items
    }))
  }, [restOfWeek])

  function Item({ e }: { e: EventRecord }) {
    const sTime = DateTime.fromISO(e.start)
    const eTime = DateTime.fromISO(e.end)
    const timeLabel = `${fmt(sTime, s.timezone, 'HH:mm')}–${fmt(eTime, s.timezone, 'HH:mm')}`
    const meta = calendarMetaFor(e)
    return (
      <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
        <div className="row between">
          <div>
            <strong>{e.title}</strong>
            <span className="hint" style={{ marginLeft: 8 }}>{timeLabel}</span>
          </div>
          <div className="row" style={{ gap: 8, alignItems:'center' }}>
            {meta.isExternal && (
              <span className="chip" style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
                <span style={{ width:8, height:8, borderRadius:999, background: meta.color || '#64748b' }} />
                <span>{meta.name || 'External'}</span>
              </span>
            )}
            <Link to="/calendar" state={{ jumpTo: e.start }} className="hint">View</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="admin" style={{ maxWidth: 860, marginInline: 'auto', paddingBottom: 80 }}>
      <h2 style={{ marginBottom: '0.5rem' }}>Welcome</h2>

      <div className="row between" style={{ gap: '.5rem', marginBottom: '.8rem' }}>
        <input placeholder="Search events..." value={query} onChange={e => setQuery(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" onClick={() => nav('/calendar', { state: { quickAddAt: DateTime.local().toISO() } })}>+ Quick add</button>
      </div>

      {happeningNow.length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Happening now</h3>
          {happeningNow.map(e => <Item key={`${e.id}-${e.start}`} e={e} />)}
        </section>
      )}

      {laterToday.length > 0 && (
        <section className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Later today</h3>
          {laterToday.map(e => <Item key={`${e.id}-${e.start}`} e={e} />)}
        </section>
      )}

      <section className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>This week</h3>
        {byDay.length === 0 && <div className="empty-state"><p>No more events this week.</p></div>}
        {byDay.map(({ day, items }) => (
          <div key={day.toISODate()} style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{day.toFormat('cccc d LLL')}</div>
            {items.map(e => <Item key={`${e.id}-${e.start}`} e={e} />)}
          </div>
        ))}
      </section>
    </div>
  )
}
