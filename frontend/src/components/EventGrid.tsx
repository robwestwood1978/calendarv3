import React, { useState } from 'react'
import { DateTime } from 'luxon'
import { listExpanded } from '../state/events-agenda'
import type { EventRecord } from '../lib/recurrence'
import { useSettings, pickEventColour } from '../state/settings'

interface GridProps {
  view: 'day' | '3day' | 'week'
  cursor: DateTime
  query: string
  onNewAt: (start: DateTime) => void
  onEdit: (evt: EventRecord) => void
  onMoveOrResize: (evt: EventRecord) => void
}

const SNAP_MINUTES = 15

function toast(msg: string) {
  try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
}

/** Safely compute a colour for a local event; never throws. */
function safePickEventColour(ev: EventRecord, settings: any): string | undefined {
  try {
    const rules = Array.isArray(settings?.colourRules) ? settings.colourRules : []
    const memberLookup = settings?.memberLookup && typeof settings.memberLookup === 'object'
      ? settings.memberLookup
      : undefined
    // If neither rules nor memberLookup, let caller fall back to calendar colour
    if ((!rules || rules.length === 0) && !memberLookup) return undefined
    return pickEventColour(ev, { rules, memberLookup })
  } catch {
    return undefined
  }
}

export function TimeGrid({ view, cursor, query, onNewAt, onEdit, onMoveOrResize }: GridProps) {
  const settings = useSettings()
  const hourHeight = settings?.denseHours ? 44 : 60

  const start = view === 'week' ? cursor.startOf('week') : cursor
  const days = view === '3day' ? 3 : view === 'day' ? 1 : 7
  const end = start.plus({ days })

  const events = listExpanded(start.startOf('day'), end.endOf('day'), query)
  const safeEvents = events.filter(e => DateTime.fromISO(e.start).isValid && DateTime.fromISO(e.end).isValid)

  const cols = Array.from({ length: days }, (_, i) => start.plus({ days: i }))

  const onBackgroundDoubleClick = (e: React.MouseEvent, day: DateTime) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const mins = Math.round((y / hourHeight) * 60 / SNAP_MINUTES) * SNAP_MINUTES
    const s = day.set({ hour: 0, minute: 0, second: 0, millisecond: 0 }).plus({ minutes: mins })
    onNewAt(s)
  }

  return (
    <div className="timewrap" style={{ ['--head-h' as any]: '34px' }}>
      <div className="time-gutter" aria-hidden="true">
        <div className="time-head" />
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className="time-tick" style={{ height: `${hourHeight}px` }}>
            {DateTime.fromObject({ hour: h }).toFormat('HH:mm')}
          </div>
        ))}
      </div>

      <div className="grid-days" style={{ gridTemplateColumns: `repeat(${days}, 1fr)` }}>
        {cols.map(d => (
          <div key={d.toISODate()} className="day-col" onDoubleClick={e => onBackgroundDoubleClick(e, d)}>
            <div className="day-head">
              <div className="day-name">{d.toFormat('ccc')}</div>
              <div className="day-date">{d.toFormat('d LLL')}</div>
            </div>
            <DayColumn
              day={d}
              hourHeight={hourHeight}
              events={safeEvents.filter(e => DateTime.fromISO(e.start).hasSame(d, 'day') && !e.allDay)}
              onEdit={onEdit}
              onCommitChange={(ev) => { onMoveOrResize(ev); toast('Saved'); }}
              settings={settings}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- Day/Week columns with live preview ---------------- */

type DragState =
  | { key: string; type: 'move'; deltaMin: number }
  | { key: string; type: 'resize'; deltaMin: number }
  | null

function DayColumn({
  day, hourHeight, events, onEdit, onCommitChange, settings,
}: {
  day: DateTime
  hourHeight: number
  events: EventRecord[]
  onEdit: (e: EventRecord) => void
  onCommitChange: (e: EventRecord) => void
  settings: any
}) {
  const [drag, setDrag] = useState<DragState>(null)
  const dayStart = day.startOf('day')

  const snap = (minutes: number) => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES
  const snapDelta = (dyPx: number) => snap((dyPx / hourHeight) * 60)

  const renderEvt = (ev: EventRecord) => {
    const s0 = DateTime.fromISO(ev.start)
    const e0 = DateTime.fromISO(ev.end)
    if (!s0.isValid || !e0.isValid) return null

    const key = `${ev.id}-${ev.start}`

    let s = s0, e = e0
    if (drag && drag.key === key) {
      if (drag.type === 'move') { s = s0.plus({ minutes: drag.deltaMin }); e = e0.plus({ minutes: drag.deltaMin }) }
      else if (drag.type === 'resize') { e = e0.plus({ minutes: drag.deltaMin }); if (e <= s) e = s.plus({ minutes: SNAP_MINUTES }) }
    }

    const top = (s.diff(dayStart, 'minutes').minutes / 60) * hourHeight
    const height = (e.diff(s, 'minutes').minutes / 60) * hourHeight

    // Priority:
    // 1) External calendar colour if provided
    // 2) Safe local rule colour (never throws)
    // 3) Theme default
    const ruleColour = safePickEventColour(ev, settings)
    const colour = (ev as any)._calendarColor || ruleColour || 'var(--primary)'

    const startDrag = (md: React.MouseEvent) => {
      md.stopPropagation(); md.preventDefault()
      const startY = md.clientY
      setDrag({ key, type: 'move', deltaMin: 0 })
      const onMoveDoc = (mm: MouseEvent) => setDrag(prev => (prev && prev.key === key && prev.type === 'move')
        ? { ...prev, deltaMin: snapDelta(mm.clientY - startY) }
        : prev)
      const onUpDoc = () => {
        window.removeEventListener('mousemove', onMoveDoc)
        window.removeEventListener('mouseup', onUpDoc)
        setDrag(prev => {
          if (prev && prev.key === key && prev.type === 'move' && prev.deltaMin !== 0) {
            // Preserve all meta so the state layer can shadow/block correctly
            onCommitChange({ ...ev, start: s0.plus({ minutes: prev.deltaMin }).toISO()!, end: e0.plus({ minutes: prev.deltaMin }).toISO()! })
          }
          return null
        })
      }
      window.addEventListener('mousemove', onMoveDoc); window.addEventListener('mouseup', onUpDoc)
    }

    const startResize = (md: React.MouseEvent) => {
      md.stopPropagation(); md.preventDefault()
      const startY = md.clientY
      setDrag({ key, type: 'resize', deltaMin: 0 })
      const onMoveDoc = (mm: MouseEvent) => setDrag(prev => (prev && prev.key === key && prev.type === 'resize')
        ? { ...prev, deltaMin: snapDelta(mm.clientY - startY) }
        : prev)
      const onUpDoc = () => {
        window.removeEventListener('mousemove', onMoveDoc)
        window.removeEventListener('mouseup', onUpDoc)
        setDrag(prev => {
          if (prev && prev.key === key && prev.type === 'resize' && prev.deltaMin !== 0) {
            onCommitChange({ ...ev, end: e0.plus({ minutes: prev.deltaMin }).toISO()! })
          }
          return null
        })
      }
      window.addEventListener('mousemove', onMoveDoc); window.addEventListener('mouseup', onUpDoc)
    }

    const isPreviewing = !!(drag && drag.key === key)

    return (
      <div
        key={key}
        className="event"
        style={{
          top, height,
          borderLeft: `3px solid ${colour}`,
          paddingLeft: 6,
          opacity: isPreviewing ? 0.8 : 1,
        }}
        onDoubleClick={() => onEdit(ev)}
        onMouseDown={startDrag}
        role="button"
      >
        <div className="evt-title">{ev.title}</div>
        <div className="evt-resize" onMouseDown={startResize} />
      </div>
    )
  }

  return (
    <div className="day-body" style={{ position: 'relative' }}>
      {/* hour rows */}
      {Array.from({ length: 24 }).map((_, h) => (
        <div key={h} className="hour-row" style={{ height: `${hourHeight}px` }} />
      ))}
      {/* events */}
      {events.map(renderEvt)}
    </div>
  )
}

/* ---------------- Month grid (optional drag) ---------------- */

interface MonthGridProps {
  cursor: DateTime
  query: string
  onNewAt: (dt: DateTime) => void
  onEdit: (evt: EventRecord) => void
  onMoveOrResize?: (evt: EventRecord) => void
}

export function MonthGrid({ cursor, query, onNewAt, onEdit, onMoveOrResize }: MonthGridProps) {
  const start = cursor.startOf('month').startOf('week')
  const days = Array.from({ length: 42 }, (_, i) => start.plus({ days: i }))
  const end = days[days.length - 1].endOf('day')

  const events = listExpanded(start, end, query).filter(e => DateTime.fromISO(e.start).isValid && DateTime.fromISO(e.end).isValid)

  const eventsForDay = (d: DateTime) => events.filter(e => DateTime.fromISO(e.start).hasSame(d, 'day'))

  const onDragDay = (original: EventRecord, newDay: DateTime) => {
    const s0 = DateTime.fromISO(original.start); const e0 = DateTime.fromISO(original.end)
    const s1 = newDay.set({ hour: s0.hour, minute: s0.minute })
    const delta = s1.diff(s0, 'minutes').minutes
    // Preserve meta here too
    const updated: EventRecord = { ...original, start: s0.plus({ minutes: delta }).toISO()!, end: e0.plus({ minutes: delta }).toISO()! }
    if (onMoveOrResize) onMoveOrResize(updated)
  }

  return (
    <div className="month-grid">
      {days.map((day, i) => {
        const todays = eventsForDay(day)
        const allDay = todays.filter(e => e.allDay)
        const timed   = todays.filter(e => !e.allDay).slice(0, 3)

        return (
          <div
            key={day.toISODate()}
            className={`mcell ${day.hasSame(cursor, 'month') ? '' : 'dim'}`}
            onDoubleClick={() => onNewAt(day.set({ hour: 9, minute: 0 }))}
          >
            <div className="mhead">{i < 7 ? day.toFormat('ccc d LLL') : day.toFormat('d')}</div>
            <div className="mitems">
              {allDay.map(e => (
                <div key={`${e.id}-${e.start}-a`} className="mall" onDoubleClick={() => onEdit(e)}>
                  <span className="dot" style={{ background: (e as any)._calendarColor || 'var(--primary)' }} /> {e.title}
                </div>
              ))}
              {timed.map(e => (
                <div
                  key={`${e.id}-${e.start}-t`}
                  className="mtimed"
                  draggable
                  onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', JSON.stringify(e)) }}
                  onDoubleClick={() => onEdit(e)}
                >
                  <span className="dot" style={{ background: (e as any)._calendarColor || 'var(--primary)' }} />
                  {DateTime.fromISO(e.start).toFormat('HH:mm')} {e.title}
                </div>
              ))}
            </div>
            {/* drop target */}
            <div
              className="dropzone"
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => {
                ev.preventDefault()
                try {
                  const raw = ev.dataTransfer.getData('text/plain')
                  const original = JSON.parse(raw) as EventRecord
                  onDragDay(original, day)
                } catch {}
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
