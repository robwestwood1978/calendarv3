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
  const { timezone, allowEditing } = settings

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
    if (view === '3day') {
      const b = cursor.plus({ days: 2 })
      return `${cursor.toFormat('ccc d LLL')} – ${b.toFormat('ccc d LLL yyyy')}`
    }
    return cursor.toFormat('cccc d LLL yyyy')
  }, [cursor.toISO(), view])

  /* ----------------- Core actions ----------------- */

  const openNewAt = (start: DateTime) => {
    const end = start.plus({ minutes: settings.defaults.durationMin })
    setEditing({
      id: undefined as any, // created on save
      title: '',
      start: start.toISO(),
      end: end.toISO(),
      allDay: false,
      attendees: [],
      tags: [],
      checklist: [],
      colour: settings.defaults.colour,
    } as EventRecord)
    setOpen(true)
  }

  const openEdit = (evt: EventRecord) => {
    setEditing(evt)
    setOpen(true)
  }

  /**
   * Drag/resize commit coming from the grid.
   * - Respect "Allow editing"
   * - External: save via agenda/shadow layer (requires _prevStart)
   * - Local recurring: include _prevStart so single-occurrence edits stick
   */
  const onMoveOrResize = (evt: EventRecord) => {
    const external = isExternal(evt) || isShadow(evt)

    if (!allowEditing) {
      // When editing is disabled, don't mutate; open the modal to view.
      setEditing(evt)
      setOpen(true)
      return
    }

    // Normalize: if the grid didn't add _prevStart (should be set), set it when start changed.
    const withPrev = (() => {
      if ((evt as any)._prevStart) return evt
      if (editing && editing.id === evt.id && editing.start && editing.start !== evt.start) {
        return { ...evt, _prevStart: editing.start } as any
      }
      return evt
    })()

    if (external) {
      // Save shadow and tombstone original occurrence
      upsertAgendaEvent(withPrev)
      return
    }

    // Local event
    // If it’s part of a series (has rrule), treat grid move as "single occurrence" edit by carrying _prevStart.
    if (withPrev.rrule) {
      upsertLocalEvent(withPrev as any, 'single')
    } else {
      upsertLocalEvent(withPrev as any, 'series')
    }
  }

  /**
   * Save from modal (local + external).
   * EventModal already adds `_prevStart` when the start changes.
   */
  const onSaveFromModal = (evt: EventRecord, editScope: 'single' | 'following' | 'series') => {
    const external = isExternal(evt) || isShadow(evt)

    if (!allowEditing) {
      // No-op when editing disabled
      setOpen(false)
      setEditing(undefined)
      return
    }

    if (external) {
      upsertAgendaEvent(evt)
      setOpen(false); setEditing(undefined)
      return
    }

    upsertLocalEvent(evt, evt.rrule ? editScope : 'series')
    setOpen(false); setEditing(undefined)
  }

  const onDeleteFromModal = (evt: EventRecord) => {
    const external = isExternal(evt) || isShadow(evt)
    if (external) deleteAgendaEvent(evt.id as any)
    else deleteLocalEvent(evt)
    setOpen(false); setEditing(undefined)
  }

  /* ----------------- Render ----------------- */

  return (
    <div className="calendar-page">
      <div className="toolbar">
        <div className="left">
          <button onClick={prev} aria-label="Previous">⟨</button>
          <button onClick={today}>Today</button>
          <button onClick={next} aria-label="Next">⟩</button>
        </div>
        <div className="center">{title}</div>
        <div className="right">
          <select value={view} onChange={e => setView(e.target.value as View)}>
            <option value="day">Day</option>
            <option value="3day">3 Days</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <input
            placeholder="Search title or tag…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {view === 'month' ? (
        <MonthGrid
          cursor={cursor}
          query={query}
          onNewAt={openNewAt}
          onEdit={openEdit}
        />
      ) : (
        <TimeGrid
          view={view as 'day' | '3day' | 'week'}
          cursor={cursor}
          query={query}
          onNewAt={openNewAt}
          onEdit={openEdit}
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
