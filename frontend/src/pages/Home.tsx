// frontend/src/pages/Home.tsx
//
// Restored "Now / Next / grouped-by-day" agenda.
// - Shows ONLY current & future events (now → +8 weeks).
// - Uses pickEventColour for accurate colours (respects rules).
// - Subscribes to fc:events-changed for instant refresh.

import React, { useMemo, useState, useEffect } from 'react'
import { DateTime } from 'luxon'
import { suggestHomeRange, listExpanded } from '../state/events-agenda'
import type { EventRecord } from '../lib/recurrence'
import { useSettings, pickEventColour } from '../state/settings'

type Group = { key: string; label: string; items: EventRecord[] }

function formatDayLabel(d: DateTime, now: DateTime) {
  if (d.hasSame(now, 'day')) return 'Today'
  if (d.hasSame(now.plus({ days: 1 }), 'day')) return 'Tomorrow'
  return d.toFormat('cccc d LLL')
}

export default function HomePage() {
  const settings = useSettings()
  const tz = settings.timezone

  const [query, setQuery] = useState('')
  const [tick, setTick] = useState(0)

  // Window: now → +8 weeks (data layer also clamps)
  const { start, end } = useMemo(
    () => suggestHomeRange(DateTime.local().setZone(tz)),
    [tz]
  )

  // React to edits instantly
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener('fc:events-changed', bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener('fc:events-changed', bump)
      window.removeEventListener('storage', bump)
    }
  }, [])

  const now = useMemo(() => DateTime.local().setZone(tz), [tz])

  // Pull & enforce future-only here too (belt-and-braces)
  const all = useMemo(() => {
    const items = listExpanded(start, end, query)
    return items.filter(e => DateTime.fromISO(e.end).setZone(tz) >= now)
  }, [start.toISO(), end.toISO(), query, tick, now.toISO(), tz])

  // Build groups
  const { nowItems, nextItems, dayGroups } = useMemo(() => {
    const ongoing: EventRecord[] = []
    const upcoming: EventRecord[] = []

    for (const e of all) {
      const s = DateTime.fromISO(e.start).setZone(tz)
      const en = DateTime.fromISO(e.end).setZone(tz)
      if (s <= now && en > now) ongoing.push(e)
      else if (s > now) upcoming.push(e)
    }

    // NEXT = first 3 upcoming (bias to today automatically by sort order)
    const next = upcoming.slice(0, 3)

    // Group remaining by day
    const remaining = upcoming.slice(3)
    const byDayMap = new Map<string, EventRecord[]>()
    for (const e of remaining) {
      const dayKey = DateTime.fromISO(e.start).setZone(tz).startOf('day').toISO()
      if (!dayKey) continue
      const arr = byDayMap.get(dayKey) || []
      arr.push(e)
      byDayMap.set(dayKey, arr)
    }

    const groups: Group[] = [...byDayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, items]) => {
        const d = DateTime.fromISO(k).setZone(tz)
        return { key: k, label: formatDayLabel(d, now), items }
      })

    return { nowItems: ongoing, nextItems: next, dayGroups: groups }
  }, [all, tz, now.toISO()])

  return (
    <div className="admin" style={{ paddingTop: 12 }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Upcoming</h2>
        <input
          placeholder="Search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ height: 34, padding: '0 .6rem' }}
        />
      </div>

      {/* NOW */}
      {nowItems.length > 0 && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Now</div>
          {nowItems.map(e => <AgendaRow key={`${e.id}-${e.start}`} e={e} tz={tz} highlightNow settings={settings} />)}
        </section>
      )}

      {/* NEXT */}
      {nextItems.length > 0 && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Next</div>
          {nextItems.map(e => <AgendaRow key={`${e.id}-${e.start}`} e={e} tz={tz} settings={settings} />)}
        </section>
      )}

      {/* BY DAY */}
      {dayGroups.map(g => (
        <section key={g.key} className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{g.label}</div>
          {g.items.map(e => <AgendaRow key={`${e.id}-${e.start}`} e={e} tz={tz} settings={settings} />)}
        </section>
      ))}

      {nowItems.length === 0 && nextItems.length === 0 && dayGroups.length === 0 && (
        <div className="empty-state">No upcoming items.</div>
      )}
    </div>
  )
}

/* ---------- row component (uses pickEventColour) ---------- */
function AgendaRow({ e, tz, settings, highlightNow = false }: {
  e: EventRecord
  tz: string
  settings: any
  highlightNow?: boolean
}) {
  const s = useMemo(() => DateTime.fromISO(e.start).setZone(tz), [e.start, tz])
  const en = useMemo(() => DateTime.fromISO(e.end).setZone(tz), [e.end, tz])
  const colour = useMemo(() => pickEventColour({
    baseColour: e.colour,
    memberNames: e.attendees,
    tags: e.tags,
    rules: settings.colourRules,
    memberLookup: settings.memberLookup,
  }) || '#1e88e5', [e.colour, e.attendees, e.tags, settings.colourRules, settings.memberLookup])

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 4px',
        borderBottom: '1px solid var(--border)',
        background: highlightNow ? 'var(--primary-weak)' : 'transparent',
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: 999, background: colour }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {e.title}
        </div>
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
}
