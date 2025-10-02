import React, { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { listExpanded } from '../state/events-agenda'
import type { EventRecord } from '../lib/recurrence'
import { useSettings, fmt } from '../state/settings'
import { Link, useNavigate } from 'react-router-dom'

export default function Home() {
  const s = useSettings()
  const nav = useNavigate()
  const [query, setQuery] = useState('')

  // bump this when anything affecting events changes (agenda toggle, auth, settings, integrations)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion(v => v + 1)
    window.addEventListener('fc:events-changed', bump)
    window.addEventListener('fc:my-agenda:changed', bump)
    window.addEventListener('fc:users:changed', bump)
    window.addEventListener('fc:settings:changed', bump)
    window.addEventListener('fc:integrations:changed', bump)
    window.addEventListener('fc:flags:changed', bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener('fc:events-changed', bump)
      window.removeEventListener('fc:my-agenda:changed', bump)
      window.removeEventListener('fc:users:changed', bump)
      window.removeEventListener('fc:settings:changed', bump)
      window.removeEventListener('fc:integrations:changed', bump)
      window.removeEventListener('fc:flags:changed', bump)
      window.removeEventListener('storage', bump)
    }
  }, [])

  // Show only today → next 7 days
  const start = DateTime.local().startOf('day')
  const end = start.plus({ days: 7 }).endOf('day')
  const now = DateTime.local()

  const events = useMemo(() => {
    const data = listExpanded(start, end, query)
    // Ensure valid times and drop anything that already finished before "now"
    return data.filter(e => {
      const st = DateTime.fromISO(e.start)
      const en = DateTime.fromISO(e.end)
      return st.isValid && en.isValid && en >= now
    })
  // include version so we recompute on agenda/auth/integration changes
  }, [start.toISO(), end.toISO(), query, version])

  // group by day
  const byDay = useMemo(() => {
    const map = new Map<string, EventRecord[]>()
    for (const e of events) {
      const key = DateTime.fromISO(e.start).toISODate()
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => a.start.localeCompare(b.start) || (a.title || '').localeCompare(b.title || ''))
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ day: DateTime.fromISO(`${k}T00:00:00`), items: v }))
  }, [events])

  return (
    <div className="admin" style={{ maxWidth: 860, marginInline: 'auto', paddingBottom: 80 }}>
      <h2 style={{ marginBottom: '0.5rem' }}>Welcome</h2>

      <div className="row between" style={{ gap: '.5rem', marginBottom: '.8rem' }}>
        <input
          placeholder="Search events..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={() => nav('/calendar', { state: { quickAddAt: DateTime.local().toISO() } })}>
          + Quick add
        </button>
      </div>

      {byDay.length === 0 && (
        <div className="empty-state">
          <p>No events in the next 7 days. Head to the <Link to="/calendar">Calendar</Link> to add one.</p>
        </div>
      )}

      {byDay.map(({ day, items }) => (
        <section className="card" key={day.toISODate()}>
          <h3 style={{ marginTop: 0 }}>{day.toFormat('cccc d LLL')}</h3>
          {items.map(e => {
            const sTime = DateTime.fromISO(e.start)
            const eTime = DateTime.fromISO(e.end)
            const timeLabel = `${fmt(sTime, s.timezone, 'HH:mm')}–${fmt(eTime, s.timezone, 'HH:mm')}`
            const chips: string[] = []
            if (e.attendees?.length) chips.push(e.attendees.join(', '))
            if (e.tags?.length) chips.push(e.tags.join(' · '))
            if (e.checklist?.length) chips.push('Bring: ' + e.checklist.join(', '))
            return (
              <div key={`${e.id}-${e.start}`} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                <div className="row between">
                  <div>
                    <strong>{e.title}</strong>
                    <span className="hint" style={{ marginLeft: 8 }}>{timeLabel}</span>
                  </div>
                  <Link to="/calendar" state={{ jumpTo: e.start }} className="hint">View</Link>
                </div>
                {chips.length > 0 && (
                  <div className="chips" style={{ marginTop: 6 }}>
                    {chips.map((c, i) => <span key={i} className="chip">{c}</span>)}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
