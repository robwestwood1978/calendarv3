// frontend/src/pages/Calendar.tsx
import React, { useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { TimeGrid, MonthGrid } from '../components/EventGrid'
import EventModal from '../components/EventModal'
import type { EventRecord } from '../lib/recurrence'

import { useSettings } from '../state/settings'
import { isExternal, isShadow } from '../lib/external'

// Local events (baseline)
import { upsertEvent as upsertLocalEvent, deleteEvent as deleteLocalEvent } from '../state/events'

// External agenda/shadows
import { upsertEvent as upsertAgendaEvent, deleteEvent as deleteAgendaEvent } from '../state/events-agenda'

type View = 'day' | '3day' | 'week' | 'month'

export default function CalendarPage() {
  const settings = useSettings()
  const { timezone } = settings

  const [view, setView] = useState<View>('week')
  const [cursor, setCursor] = useState(DateTime.local().setZone(timezone).startOf('day'))
  const [query, setQuery] = useState('')

  // modal state
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<EventRecord | undefined>(undefined)

  const next = () => setCursor(v => view === 'month' ? v.plus({ months: 1 }) :
                                       view === 'week'  ? v.plus({ weeks: 1 })  :
                                       view === '3day' ? v.plus({ days: 3 })    :
                                                         v.plus({ days: 1 }))
  const prev = () => setCursor(v => view === 'month' ? v.minus({ months: 1 }) :
                                       view === 'week'  ? v.minus({ weeks: 1 })  :
                                       view === '3day' ? v.minus({ days: 3 })    :
                                                         v.minus({ days: 1 }))
  const today = () => setCursor(DateTime.local().setZone(timezone).startOf('day'))

  const title = useMemo(() => {
    if (view === 'month') return cursor.toFormat('LLLL yyyy')
    if (view === 'week') {
      const a = cursor.startOf('week'), b = cursor.endOf('week')
      return `${a.toFormat('d LLL')} – ${b.toFormat('d LLL yyyy')}`
    }
    if (view === '3day') return `${cursor.toFormat('ccc d LLL')} – ${cursor.plus({ days: 2 }).toFormat('ccc d LLL yyyy')}`
    return cursor.toFormat('ccc d LLL yyyy')
  }, [cursor, view])

  const onNewAt = (start: DateTime) => {
    setEditing({
      title: '',
      start: start.toISO()!,
      end: start.plus({ minutes: settings.defaults.durationMin }).toISO()!,
      tags: [],
      checklist: [],
    } as EventRecord)
    setOpen(true)
  }

  const onEdit = (evt: EventRecord) => { setEditing(evt); setOpen(true) }

  // Grid drag/resize commits — always persist; write-guards live in state layer
  const onMoveOrResize = (evt: EventRecord) => {
    const external = isExternal(evt) || isShadow(evt)
    const withPrev = { ...evt, _prevStart: (evt as any)._prevStart || evt.start } as any
    if (external) { upsertAgendaEvent(withPrev); return }
    if (withPrev.rrule) upsertLocalEvent(withPrev, 'single'); else upsertLocalEvent(withPrev, 'series')
  }

  // Modal save
  const onSaveFromModal = (evt: EventRecord, editScope: 'single' | 'following' | 'series') => {
    const external = isExternal(evt) || isShadow(evt)
    if (external) { upsertAgendaEvent(evt); setOpen(false); setEditing(undefined); return }
    upsertLocalEvent(evt, evt.rrule ? editScope : 'series')
    setOpen(false); setEditing(undefined)
  }

  const onDeleteFromModal = (evt: EventRecord) => {
    const external = isExternal(evt) || isShadow(evt)
    if (external) { deleteAgendaEvent(evt.id!); setOpen(false); setEditing(undefined); return }
    deleteLocalEvent(evt, evt.rrule ? 'series' : 'series')
    setOpen(false); setEditing(undefined)
  }

  return (
    <div className="calendar-page">
      {/* Toolbar */}
      <div className="toolbar">
        <div className="left">
          <button onClick={prev}>{'←'}</button>
          <button onClick={today}>Today</button>
          <button onClick={next}>{'→'}</button>
        </div>
        <div className="center">{title}</div>
        <div className="right">
          <select value={view} onChange={e => setView(e.target.value as View)}>
            <option value="day">Day</option>
            <option value="3day">3 days</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <input placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
      </div>

      {/* Grids */}
      {view === 'month' ? (
        <MonthGrid cursor={cursor} query={query} onNewAt={onNewAt} onEdit={onEdit} />
      ) : (
        <TimeGrid
          view={view === '3day' ? '3day' : (view as 'day'|'week')}
          cursor={cursor}
          query={query}
          onNewAt={onNewAt}
          onEdit={onEdit}
          onMoveOrResize={onMoveOrResize}
        />
      )}

      {/* Modal */}
      <EventModal
        open={open}
        initial={editing}
        onClose={() => { setOpen(false); setEditing(undefined) }}
        onSave={onSaveFromModal}
      />
    </div>
  )
}
