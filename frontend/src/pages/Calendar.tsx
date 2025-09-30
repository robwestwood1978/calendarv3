// frontend/src/pages/Calendar.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import EventModal from '../components/EventModal'
import { TimeGrid, MonthGrid } from '../components/EventGrid'
import { upsertEvent, deleteEvent } from '../state/events'
import type { EventRecord } from '../lib/recurrence'

type View = 'day' | '3day' | 'week' | 'month'

export default function CalendarPage() {
  const [view, setView] = useState<View>('week')
  const [cursor, setCursor] = useState(DateTime.local())
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<EventRecord | undefined>()
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const bump = () => setVersion(v => v + 1)
    window.addEventListener('fc:events-changed', bump)
    return () => window.removeEventListener('fc:events-changed', bump)
  }, [])

  const hasAny = useMemo(() => {
    try {
      return !!(localStorage.getItem('fc_events_v1') && JSON.parse(localStorage.getItem('fc_events_v1') || '[]').length)
    } catch { return false }
  }, [modalOpen, version])

  const openNew = (dt: DateTime) => {
    setSelected({
      title: '',
      start: dt.toISO(),
      end: dt.plus({ hours: 1 }).toISO(),
      tags: [],
      checklist: [],
    } as EventRecord)
    setModalOpen(true)
  }

  const handleSave = (evt: EventRecord, mode: 'single' | 'following' | 'series') => {
    upsertEvent(evt, mode)
    setModalOpen(false)
  }

  // When moving/resizing a recurring event, ask scope
  const saveMoveOrResize = (evt: EventRecord) => {
    if (!evt.rrule) { upsertEvent(evt, 'series'); return }
    const choice = window.prompt(
      'Apply move/resize to:\n1 = This occurrence\n2 = This and following\n3 = Entire series',
      '1'
    )
    const mode = choice === '3' ? 'series' : choice === '2' ? 'following' as const : 'single' as const
    upsertEvent(evt, mode)
  }

  const prev = () => {
    if (view === 'day') setCursor(cursor.minus({ days: 1 }))
    else if (view === '3day') setCursor(cursor.minus({ days: 3 }))
    else if (view === 'week') setCursor(cursor.minus({ weeks: 1 }))
    else if (view === 'month') setCursor(cursor.minus({ months: 1 }))
  }
  const next = () => {
    if (view === 'day') setCursor(cursor.plus({ days: 1 }))
    else if (view === '3day') setCursor(cursor.plus({ days: 3 }))
    else if (view === 'week') setCursor(cursor.plus({ weeks: 1 }))
    else if (view === 'month') setCursor(cursor.plus({ months: 1 }))
  }
  const today = () => setCursor(DateTime.local())

  const rangeLabel = () => {
    if (view === 'day') return cursor.toFormat('cccc d LLL yyyy')
    if (view === '3day') return `${cursor.toFormat('d LLL')} – ${cursor.plus({ days: 2 }).toFormat('d LLL yyyy')}`
    if (view === 'week') return `${cursor.startOf('week').toFormat('d LLL')} – ${cursor.endOf('week').toFormat('d LLL yyyy')}`
    if (view === 'month') return cursor.toFormat('LLLL yyyy')
  }

  return (
    <div className="calendar-page" data-v={version}>
      <header className="toolbar">
        <div className="left">
          <button onClick={prev} title="Previous">‹</button>
          <button onClick={today} title="Today">Today</button>
          <button onClick={next} title="Next">›</button>
        </div>
        <div className="center">{rangeLabel()}</div>
        <div className="right">
          <select value={view} onChange={e => setView(e.target.value as View)}>
            <option value="day">Day</option>
            <option value="3day">3 days</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <input placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} />
          <button className="primary" onClick={() => openNew(DateTime.local().startOf('hour'))}>+ Add event</button>
        </div>
      </header>

      {!hasAny && (
        <div className="empty-state">
          <div>
            <h4>Welcome 👋</h4>
            <p>Click <strong>+ Add event</strong> or <strong>double-click</strong> the calendar to create your first event.</p>
          </div>
        </div>
      )}

      <main className="main">
        {view === 'month' ? (
          <MonthGrid
            cursor={cursor}
            query={query}
            onNewAt={openNew}
            onEdit={e => { setSelected(e); setModalOpen(true) }}
            key={`m-${version}-${cursor.toISODate()}`}
          />
        ) : (
          <TimeGrid
            view={view}
            cursor={cursor}
            query={query}
            onNewAt={openNew}
            onEdit={e => { setSelected(e); setModalOpen(true) }}
            onMoveOrResize={saveMoveOrResize}
            key={`t-${version}-${view}-${cursor.startOf('week').toISODate()}`}
          />
        )}
      </main>

      {modalOpen && (
        <EventModal
          open={modalOpen}
          initial={selected}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
