// frontend/src/pages/Home.tsx
//
// Lightweight, fast "upcoming" agenda:
// - Only loads a window (today → +6 weeks by default).
// - Respects "My Agenda" and linked calendar filters via the data layer.
// - Re-renders immediately on writes.

import React, { useMemo, useState, useEffect } from 'react'
import { DateTime } from 'luxon'
import { suggestHomeRange, listExpanded } from '../state/events-agenda'
import type { EventRecord } from '../lib/recurrence'
import { useSettings } from '../state/settings'

export default function HomePage() {
  const settings = useSettings()
  const [query, setQuery] = useState('')
  const [tick, setTick] = useState(0)

  // Recompute window once per mount or when timezone changes
  const { start, end } = useMemo(() => suggestHomeRange(DateTime.local().setZone(settings.timezone)), [settings.timezone])

  // Subscribe so we refresh immediately on edits
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener('fc:events-changed', bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener('fc:events-changed', bump)
      window.removeEventListener('storage', bump)
    }
  }, [])

  const items: EventRecord[] = useMemo(() => listExpanded(start, end, query), [start.toISO(), end.toISO(), query, tick])

  return (
    <div className="admin" style={{ paddingTop: 12 }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Upcoming (next 6 weeks)</h2>
        <input
          placeholder="Search your agenda…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ height: 34, padding: '0 .6rem' }}
        />
      </div>

      {items.length === 0 ? (
        <div className="empty-state">No upcoming items.</div>
      ) : (
        <div className="card">
          {items.map(e => {
            const s = DateTime.fromISO(e.start).setZone(settings.timezone)
            const en = DateTime.fromISO(e.end).setZone(settings.timezone)
            return (
              <div key={`${e.id}-${e.start}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: e.colour || '#1e88e5' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  <div className="hint" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {s.toFormat('ccc d LLL, HH:mm')} – {en.toFormat('HH:mm')}
                  </div>
                </div>
                {(e.attendees && e.attendees.length > 0) && (
                  <div className="hint" title={e.attendees.join(', ')} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.attendees.join(', ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
