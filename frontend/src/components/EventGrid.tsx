// frontend/src/components/EventGrid.tsx
import React, { useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { listExpanded } from '../state/events-agenda'
import type { EventRecord } from '../lib/recurrence'
import { useSettings, pickEventColour } from '../state/settings'
import '../calendar-hotfix.css'

interface GridProps {
  view: 'day' | '3day' | 'week'
  cursor: DateTime
  query: string
  onNewAt: (start: DateTime) => void
  onEdit: (evt: EventRecord) => void
  onMoveOrResize: (evt: EventRecord) => void
}

const SNAP_MINUTES = 15
const DRAG_THRESHOLD_PX = 3

function toast(msg: string) {
  try { window.dispatchEvent(new CustomEvent('toast', { detail: msg })) } catch {}
}

/** Correctly resolves colour using rules + members + tags (safe against missing settings). */
function safePickEventColour(ev: EventRecord, settings: any): string | undefined {
  try {
    const rules = Array.isArray(settings?.colourRules) ? settings.colourRules : []
    const memberLookup = (settings && settings.memberLookup && typeof settings.memberLookup === 'object') ? settings.memberLookup : {}
    const memberNames = Array.isArray((ev as any).attendees) ? (ev as any).attendees : []
    const tags = Array.isArray((ev as any).tags) ? (ev as any).tags : []
    const baseColour = (ev as any).colour
    return pickEventColour({ baseColour, memberNames, tags, rules, memberLookup })
  } catch { return undefined }
}

// Choose readable text color (white/ink) for a given hex color (fallback to white).
function idealTextColor(bg: string | undefined): string {
  if (!bg) return '#fff'
  // if CSS var or non-hex, default to white text (works for primary blues/greens)
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(bg)) return '#fff'
  let r, g, b;
  if (bg.length === 4) {
    r = parseInt(bg[1]+bg[1],16)
    g = parseInt(bg[2]+bg[2],16)
    b = parseInt(bg[3]+bg[3],16)
  } else {
    r = parseInt(bg.slice(1,3),16)
    g = parseInt(bg.slice(3,5),16)
    b = parseInt(bg.slice(5,7),16)
  }
  const luminance = (0.299*r + 0.587*g + 0.114*b) / 255
  return luminance > 0.6 ? '#0f172a' : '#fff'
}

export function TimeGrid({ view, cursor, query, onNewAt, onEdit, onMoveOrResize }: GridProps) {
  const settings = useSettings()
  const hourHeight = settings?.denseHours ? 44 : 60

  const start = view === 'week' ? cursor.startOf('week') : cursor
  const days = view === '3day' ? 3 : view === 'day' ? 1 : 7
  const end = start.plus({ days })
  const cols = useMemo(() => Array.from({ length: days }, (_, i) => start.plus({ days: i })), [start.toISODate(), days])

  // Expand + validate + dedupe (id@start)
  const safeEvents = useMemo(() => {
    const data = listExpanded(start.startOf('day'), end.endOf('day'), query)
      .filter(e => DateTime.fromISO(e.start).isValid && DateTime.fromISO(e.end).isValid)
    const out: EventRecord[] = []
    const seen = new Set<string>()
    for (const e of data) {
      const key = `${e.id}@@${e.start}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
    return out
  }, [start.toISO(), end.toISO(), query])

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

      <div className="grid-days">
        <div className="time-head row" />
        {cols.map((d) => (
          <div key={d.toISODate()} className="day-col">
            <div className="day-head">
              <div className="day-name">{d.toFormat('EEE')}</div>
              <div className="day-date">{d.toFormat('d LLL')}</div>
            </div>
            <div
              className="day-body"
              onDoubleClick={(e) => onBackgroundDoubleClick(e, d)}
              style={{ height: `${24 * hourHeight}px` }}
            >
              <DayEvents
                day={d}
                hourHeight={hourHeight}
                events={safeEvents}
                onEdit={onEdit}
                onCommitChange={onMoveOrResize}
                settings={settings}
              />
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="hour-row" style={{ height: `${hourHeight}px` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type DragState =
  | null
  | { key: string; type: 'move'; deltaMin: number; startY: number; moved: boolean }
  | { key: string; type: 'resize'; deltaMin: number; startY: number; moved: boolean }

function DayEvents({
  day, hourHeight, events, onEdit, onCommitChange, settings
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

    const ruleColour = safePickEventColour(ev, settings)
    const colour = (ev as any)._calendarColor || ruleColour || 'var(--primary)'

    const beginDrag = (md: React.MouseEvent, type: 'move'|'resize') => {
      md.stopPropagation(); md.preventDefault()
      const startY = md.clientY
      setDrag({ key, type, deltaMin: 0, startY, moved: false })

      const onMoveDoc = (mm: MouseEvent) => {
        const dy = mm.clientY - startY
        if (!drag?.moved && Math.abs(dy) > DRAG_THRESHOLD_PX) setDrag(prev => prev ? { ...prev, moved: true } : prev)
        setDrag(prev => prev ? { ...prev, deltaMin: snapDelta(dy) } : prev)
      }
      const onUpDoc = (_up: MouseEvent) => {
        window.removeEventListener('mousemove', onMoveDoc)
        window.removeEventListener('mouseup', onUpDoc)
        setDrag(prev => {
          if (!prev) return null
          const { type } = prev
          if (!prev.moved) return null
          if (prev.deltaMin !== 0) {
            if (type === 'move') {
              onCommitChange({
                ...ev,
                _prevStart: (ev as any).start,
                start: s0.plus({ minutes: prev.deltaMin }).toISO()!,
                end:   e0.plus({ minutes: prev.deltaMin }).toISO()!,
              } as any)
            } else {
              onCommitChange({
                ...ev,
                _prevStart: (ev as any).start,
                end: e0.plus({ minutes: prev.deltaMin }).toISO()!,
              } as any)
            }
          }
          return null
        })
      }

      window.addEventListener('mousemove', onMoveDoc)
      window.addEventListener('mouseup', onUpDoc)
    }

    const isPreviewing = !!(drag && drag.key === key)
    const textColor = idealTextColor(typeof colour === 'string' ? colour : undefined)

    return (
      <div
        key={key}
        className="event"
        role="button"
        onMouseDown={(e) => beginDrag(e, 'move')}
        style={{
          position: 'absolute',
          left: 6, right: 6,
          top, height,
          zIndex: 1000,
          background: colour,
          borderRadius: 12,
          boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
          borderLeft: `3px solid ${colour}`,
          color: textColor,
          padding: '6px 8px 10px 8px',
          cursor: 'pointer',
          opacity: isPreviewing ? 0.95 : 1,
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        <div
          className="evt-title"
          style={{
            position: 'relative', zIndex: 2,
            fontWeight: 600, fontSize: 13,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            color: 'inherit',
            pointerEvents: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); onEdit(ev) }}
        >
          {ev.title}
        </div>

        <div
          className="evt-resize"
          onMouseDown={(e) => beginDrag(e, 'resize')}
          style={{
            position: 'absolute',
            left: 8, right: 8,
            bottom: 4,
            height: 6,
            borderRadius: 999,
            background: 'rgba(0,0,0,0.08)',
            cursor: 'ns-resize',
            zIndex: 2,
          }}
        />
      </div>
    )
  }

  const eventsForDay = (d: DateTime) => events.filter(e => DateTime.fromISO(e.start).hasSame(d, 'day'))

  return <>{eventsForDay(day).map(renderEvt)}</>
}

export function MonthGrid({ cursor, query, onNewAt, onEdit, onMoveOrResize }: {
  cursor: DateTime
  query: string
  onNewAt: (start: DateTime) => void
  onEdit: (evt: EventRecord) => void
  onMoveOrResize?: (evt: EventRecord) => void
}) {
  const start = cursor.startOf('month').startOf('week')
  const days = Array.from({ length: 42 }, (_, i) => start.plus({ days: i }))
  const end = days[days.length - 1].endOf('day')

  const events = listExpanded(start, end, query)
    .filter(e => DateTime.fromISO(e.start).isValid && DateTime.fromISO(e.end).isValid)

  const eventsForDay = (d: DateTime) => events.filter(e => DateTime.fromISO(e.start).hasSame(d, 'day'))

  const onDragDay = (original: EventRecord, newDay: DateTime) => {
    const s0 = DateTime.fromISO(original.start); const e0 = DateTime.fromISO(original.end)
    const s1 = newDay.set({ hour: s0.hour, minute: s0.minute })
    const delta = s1.diff(s0, 'minutes').minutes
    const updated: EventRecord = {
      ...original,
      _prevStart: original.start,
      start: s0.plus({ minutes: delta }).toISO()!,
      end:   e0.plus({ minutes: delta }).toISO()!,
    }
    onMoveOrResize && onMoveOrResize(updated)
  }

  return (
    <div className="month-grid">
      {days.map((day, i) => {
        const todays = eventsForDay(day)
        const allDay = todays.filter(e => e.allDay)
        const timed   = todays.filter(e => !e.allDay)

        return (
          <div
            key={day.toISODate()}
            className={`mcell ${day.hasSame(cursor, 'month') ? '' : 'dim'}`}
            onDoubleClick={() => onNewAt(day.set({ hour: 9, minute: 0 }))}
            onDragOver={(ev) => ev.preventDefault()}
            onDrop={(ev) => {
              ev.preventDefault()
              try {
                const raw = ev.dataTransfer.getData('text/plain')
                const original = JSON.parse(raw) as EventRecord
                onDragDay(original, day)
              } catch {}
            }}
          >
            <div className="mhead">
              {i < 7 && <div className="dow">{day.toFormat('EEE')}</div>}
              <div className="d">{day.toFormat('d')}</div>
            </div>

            <div className="mbody">
              {allDay.map(e => (
                <button
                  key={`${e.id}-${e.start}-a`}
                  className="mall"
                  onClick={() => onEdit(e)}
                  draggable
                  onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', JSON.stringify(e)) }}
                >
                  {e.title}
                </button>
              ))}
              {timed.map(e => (
                <button
                  key={`${e.id}-${e.start}-t`}
                  className="mtimed"
                  onClick={() => onEdit(e)}
                  draggable
                  onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', JSON.stringify(e)) }}
                  style={{
                    display:'flex', alignItems:'center', gap:6,
                    background:'transparent', border:0, textAlign:'left', padding:2, cursor:'pointer'
                  }}
                >
                  <span className="dot" style={{ width:8, height:8, borderRadius:999, background: (e as any)._calendarColor || 'var(--primary)' }} />
                  <span>{DateTime.fromISO(e.start).toFormat('HH:mm')} {e.title}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
