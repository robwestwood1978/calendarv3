import React, { useRef, useState, useMemo, useCallback } from 'react'
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
const CLICK_DRAG_THRESHOLD_PX = 3

/* ------------- Toast helper ------------- */
function toast(msg: string) {
  try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
}

export function TimeGrid({ view, cursor, query, onNewAt, onEdit, onMoveOrResize }: GridProps) {
  const settings = useSettings()
  const hourHeight = settings.denseHours ? 44 : 60

  // Compute the time range for this grid
  const start = useMemo(
    () => (view === 'week' ? cursor.startOf('week') : cursor),
    [view, cursor.toISO()]
  )
  const days = view === '3day' ? 3 : view === 'day' ? 1 : 7
  const end = useMemo(() => start.plus({ days }), [start.toISO(), days])

  // Expand events once per range/query
  const events = useMemo(
    () => listExpanded(start.startOf('day'), end.endOf('day'), query),
    [start.toISO(), end.toISO(), query]
  )
  const safeEvents = useMemo(
    () => events.filter(e => DateTime.fromISO(e.start).isValid && DateTime.fromISO(e.end).isValid),
    [events]
  )

  // Columns for days + scroll sync refs
  const cols = useMemo(() => Array.from({ length: days }, (_, i) => start.plus({ days: i })), [days, start.toISO()])
  const gutterRef = useRef<HTMLDivElement>(null)
  const daysRef = useRef<HTMLDivElement>(null)

  const onDaysScroll = useCallback(() => {
    const g = gutterRef.current
    const d = daysRef.current
    if (!g || !d) return
    // micro-throttle via requestAnimationFrame
    if ((onDaysScroll as any)._raf) return
    ;(onDaysScroll as any)._raf = requestAnimationFrame(() => {
      g.scrollTop = d.scrollTop
      ;(onDaysScroll as any)._raf = 0
    })
  }, [])

  const onBackgroundDoubleClick = (e: React.MouseEvent, day: DateTime) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const mins = Math.round((y / hourHeight) * 60 / SNAP_MINUTES) * SNAP_MINUTES
    const s = day.set({ hour: 0, minute: 0, second: 0, millisecond: 0 }).plus({ minutes: mins })
    onNewAt(s)
  }

  return (
    <div className="timewrap" style={{ ['--head-h' as any]: '34px' }}>
      {/* Gutter with its own scroller; we will sync it to daysRef */}
      <div className="time-gutter" aria-hidden="true" ref={gutterRef} style={{ overflowY: 'auto' }}>
        <div className="time-head" />
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className="time-tick" style={{ height: `${hourHeight}px` }}>
            {DateTime.fromObject({ hour: h }, { zone: settings.timezone }).toFormat('HH:mm')}
          </div>
        ))}
      </div>

      <div
        className="grid-days"
        ref={daysRef}
        onScroll={onDaysScroll}
        style={{ gridTemplateColumns: `repeat(${days}, 1fr)`, overflowY: 'auto', overflowX: 'hidden' }}
      >
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

/* ---------------- Day/Week columns with live preview + click suppression ---------------- */

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

  // click suppression for drags
  const dragMetaRef = useRef<{ key?: string; startY?: number; startX?: number; moved?: boolean }>({})
  const lastDraggedKeyRef = useRef<string | null>(null)
  const clearClickBlockSoon = (key: string) => {
    lastDraggedKeyRef.current = key
    setTimeout(() => { if (lastDraggedKeyRef.current === key) lastDraggedKeyRef.current = null }, 180)
  }

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

    // drag anywhere on card
    const onCardMouseDown = (md: React.MouseEvent) => {
      md.stopPropagation(); md.preventDefault()
      dragMetaRef.current = { key, startY: md.clientY, startX: md.clientX, moved: false }
      setDrag({ key, type: 'move', deltaMin: 0 })

      const onMoveDoc = (mm: MouseEvent) => {
        const dy = mm.clientY - (dragMetaRef.current.startY || mm.clientY)
        const dx = mm.clientX - (dragMetaRef.current.startX || mm.clientX)
        if (!dragMetaRef.current.moved && (Math.abs(dy) > CLICK_DRAG_THRESHOLD_PX || Math.abs(dx) > CLICK_DRAG_THRESHOLD_PX)) {
          dragMetaRef.current.moved = true
        }
        setDrag(prev => (prev && prev.key === key && prev.type === 'move') ? { ...prev, deltaMin: snapDelta(dy) } : prev)
      }
      const onUpDoc = () => {
        window.removeEventListener('mousemove', onMoveDoc)
        window.removeEventListener('mouseup', onUpDoc)
        setDrag(prev => {
          const moved = !!dragMetaRef.current.moved
          if (prev && prev.key === key && prev.type === 'move' && prev.deltaMin !== 0) {
            // Preserve original occurrence across re-edits (external + local recurring)
            const origOcc = (ev as any)._origOccStart || (ev as any)._prevStart || ev.start
            onCommitChange({
              ...ev,
              _prevStart: ev.start as any,          // for your existing handlers
              _origOccStart: origOcc as any,        // stable key across re-edits
              start: s0.plus({ minutes: prev.deltaMin }).toISO()!,
              end: e0.plus({ minutes: prev.deltaMin }).toISO()!,
            } as any)
          }
          if (moved) clearClickBlockSoon(key)
          return null
        })
      }
      window.addEventListener('mousemove', onMoveDoc)
      window.addEventListener('mouseup', onUpDoc)
    }

    const startResize = (md: React.MouseEvent) => {
      md.stopPropagation(); md.preventDefault()
      dragMetaRef.current = { key, startY: md.clientY, startX: md.clientX, moved: false }
      setDrag({ key, type: 'resize', deltaMin: 0 })

      const onMoveDoc = (mm: MouseEvent) => {
        const dy = mm.clientY - (dragMetaRef.current.startY || mm.clientY)
        if (!dragMetaRef.current.moved && Math.abs(dy) > CLICK_DRAG_THRESHOLD_PX) dragMetaRef.current.moved = true
        setDrag(prev => (prev && prev.key === key && prev.type === 'resize') ? { ...prev, deltaMin: snapDelta(dy) } : prev)
      }
      const onUpDoc = () => {
        window.removeEventListener('mousemove', onMoveDoc)
        window.removeEventListener('mouseup', onUpDoc)
        setDrag(prev => {
          const moved = !!dragMetaRef.current.moved
          if (prev && prev.key === key && prev.type === 'resize' && prev.deltaMin !== 0) {
            const newEnd = e0.plus({ minutes: prev.deltaMin })
            const origOcc = (ev as any)._origOccStart || (ev as any)._prevStart || ev.start
            onCommitChange({
              ...ev,
              _prevStart: ev.start as any,
              _origOccStart: origOcc as any,
              end: (newEnd > s0 ? newEnd : s0.plus({ minutes: SNAP_MINUTES })).toISO()!,
            } as any)
          }
          if (moved) clearClickBlockSoon(key)
          return null
        })
      }
      window.addEventListener('mousemove', onMoveDoc)
      window.addEventListener('mouseup', onUpDoc)
    }

    const isPreviewing = !!(drag && drag.key === key)

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      // If we just dragged this key, ignore the click.
      if (lastDraggedKeyRef.current === key) return
      onEdit(ev)
    }

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
          cursor: 'grab',
        }}
        onMouseDown={onCardMouseDown}
        onClick={handleClick}
        role="button"
        aria-label={`${ev.title} ${sZ.toFormat('HH:mm')}–${eZ.toFormat('HH:mm')}`}
      >
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

/* ---------------- Month grid (unchanged) ---------------- */

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
