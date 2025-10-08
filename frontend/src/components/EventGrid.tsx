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

export function TimeGrid({ view, cursor, query, onNewAt, onEdit, onMoveOrResize }: GridProps) {
  const settings = useSettings()
  const hourHeight = settings.denseHours ? 44 : 60

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
            {DateTime.fromObject({ hour: h }, { zone: settings.timezone }).toFormat('HH:mm')}
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

    // Zone-normalised geometry so hour ticks and events always align
    const sZ = s.setZone(day.zoneName as any)
    const eZ = e.setZone(day.zoneName as any)
    const top = (sZ.diff(dayStart, 'minutes').minutes / 60) * hourHeight
    const height = Math.max(24, (eZ.diff(sZ, 'minutes').minutes / 60) * hourHeight)

    const colour = pickEventColour({
      baseColour: ev.colour,
      memberNames: ev.attendees,
      tags: ev.tags,
      rules: settings.colourRules,
      memberLookup: settings.memberLookup,
    })

    const startDrag = (md: React.MouseEvent) => {
      md.stopPropagation(); md.preventDefault()
      const startY = md.clientY
      setDrag({ key, type: 'move', deltaMin: 0 })
      const onMoveDoc = (mm: MouseEvent) => setDrag(prev => (prev && prev.key === key && prev.type === 'move') ? { ...prev, deltaMin: snapDelta(mm.clientY - startY) } : prev)
      const onUpDoc = () => {
        window.removeEventListener('mousemove', onMoveDoc)
        window.removeEventListener('mouseup', onUpDoc)
        setDrag(prev => {
          if (prev && prev.key === key && prev.type === 'move' && prev.deltaMin !== 0) {
            onCommitChange({ ...ev, _prevStart: ev.start as any, start: s0.plus({ minutes: prev.deltaMin }).toISO()!, end: e0.plus({ minutes: prev.deltaMin }).toISO()! } as any)
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
      const onMoveDoc = (mm: MouseEvent) => setDrag(prev => (prev && prev.key === key && prev.type === 'resize') ? { ...prev, deltaMin: snapDelta(mm.clientY - startY) } : prev)
      const onUpDoc = () => {
        window.removeEventListener('mousemove', onMoveDoc)
        window.removeEventListener('mouseup', onUpDoc)
        setDrag(prev => {
          if (prev && prev.key === key && prev.type === 'resize' && prev.deltaMin !== 0) {
            const newEnd = e0.plus({ minutes: prev.deltaMin })
            onCommitChange({ ...ev, _prevStart: ev.start as any, end: (newEnd > s0 ? newEnd : s0.plus({ minutes: SNAP_MINUTES })).toISO()! } as any)
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
          background: colour || '#1e88e5',
          zIndex: isPreviewing ? 3 : 2,
          boxShadow: isPreviewing ? '0 6px 20px rgba(0,0,0,.25)' : undefined,
          opacity: isPreviewing ? 0.92 : 1,
        }}
        onClick={(e) => { e.stopPropagation(); onEdit(ev) }}
        role="button"
        aria-label={`${ev.title} ${sZ.toFormat('HH:mm')}–${eZ.toFormat('HH:mm')}`}
      >
        <div className="drag-handle" onMouseDown={startDrag} title="Drag to move" />
        <div className="event-body">
          <div className="title" title={ev.title}>{ev.title}</div>
          <div className="time">{sZ.toFormat('HH:mm')}–{eZ.toFormat('HH:mm')}</div>
        </div>
        <div className="resize-handle" onMouseDown={startResize} title="Drag to resize" />
      </div>
    )
  }

  return (
    <div
      className="day-stack"
      style={{
        height: `calc(24 * ${hourHeight}px)`,
        backgroundImage: `linear-gradient(to bottom, transparent ${hourHeight - 1}px, var(--border) ${hourHeight}px)`,
        backgroundSize: `100% ${hourHeight}px`,
      }}
    >
      {events.map(renderEvt)}
    </div>
  )
}

/* ---------------- Month grid unchanged (kept for completeness) ---------------- */

export function MonthGrid({
  cursor, query, onNewAt, onEdit,
}: {
  cursor: DateTime
  query: string
  onNewAt: (start: DateTime) => void
  onEdit: (e: EventRecord) => void
}) {
  const settings = useSettings()
  const start = cursor.startOf('month').startOf('week')
  const end = cursor.endOf('month').endOf('week')
  const events = listExpanded(start, end, query)
  const safeEvents = events.filter(e => DateTime.fromISO(e.start).isValid && DateTime.fromISO(e.end).isValid)

  const days: DateTime[] = []
  let d = start
  while (d <= end) { days.push(d); d = d.plus({ days: 1 }) }

  const eventsForDay = (day: DateTime) =>
    safeEvents.filter(e => DateTime.fromISO(e.start).hasSame(day, 'day'))

  const colourFor = (e: EventRecord) =>
    pickEventColour({
      baseColour: e.colour,
      memberNames: e.attendees,
      tags: e.tags,
      rules: settings.colourRules,
      memberLookup: settings.memberLookup,
    })

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
            <div className="mhead">{i < 7 ? day.toFormat('ccc d') : day.toFormat('d')}</div>

            {allDay.length > 0 && (
              <div className="mbadges">
                {allDay.slice(0, 3).map(e => {
                  const col = colourFor(e) || '#1e88e5'
                  return (
                    <button
                      key={`${e.id}-${e.start}-ad`}
                      className="mbadge"
                      style={{ background: col, color: '#fff', borderColor: col }}
                      title={e.title}
                      onClick={() => onEdit(e)}
                    >
                      {e.title}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="mlist">
              {timed.map(e => {
                const col = colourFor(e) || '#1e88e5'
                return (
                  <button
                    key={`${e.id}-${e.start}`}
                    className="mitem"
                    onClick={() => onEdit(e)}
                    style={{ background: col, color: '#fff', borderColor: col }}
                    title={e.title}
                  >
                    <span className="mtitle">{e.title}</span>
                    <span className="mtime">{DateTime.fromISO(e.start).toFormat('HH:mm')}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ToastHost() {
  const [msg, setMsg] = React.useState<string | null>(null)
  React.useEffect(() => {
    const h = (e: Event) => {
      const ce = e as CustomEvent<string>
      setMsg(ce.detail)
      const t = setTimeout(() => setMsg(null), 1400)
      return () => clearTimeout(t)
    }
    window.addEventListener('toast', h as any)
    return () => window.removeEventListener('toast', h as any)
  }, [])
  if (!msg) return null
  return <div className="toast">{msg}</div>
}
