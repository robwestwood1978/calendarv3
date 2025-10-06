import React, { useEffect, useMemo, useState } from 'react'
import { DateTime, Duration } from 'luxon'
import { useSettings } from '../state/settings'
import type { EventRecord } from '../lib/recurrence'

// Local (baseline) delete for your own events/series logic
import { deleteEvent as deleteLocalEvent } from '../state/events'

// NEW: state layer that handles shadows for external events
import { upsertEvent as upsertAgendaEvent, deleteEvent as deleteAgendaEvent } from '../state/events-agenda'

// NEW: helpers to detect external/shadow + fetch calendar meta (name/colour)
import { calendarMetaFor, isExternal, isShadow } from '../lib/external'

export type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

interface Props {
  open: boolean
  initial?: EventRecord
  onClose: () => void
  onSave: (evt: EventRecord, editMode: 'single' | 'following' | 'series') => void
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DUR_PRESETS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '1½ hr', minutes: 90 },
  { label: '2 hr', minutes: 120 },
]
const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s)

type MonthlyMode = 'date' | 'weekday'
type YearlyMode  = 'date' | 'weekday'

export default function EventModal({ open, initial, onClose, onSave }: Props) {
  const settings = useSettings()
  const { tags: presetTags, bringPresets, members, defaults, timezone } = settings

  // ------- NEW: external/shadow metadata for header badge -------
  const meta = useMemo(() => calendarMetaFor(initial), [initial])
  const external = !!(initial && isExternal(initial))
  const shadow = !!(initial && isShadow(initial))

  // core
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [start, setStart] = useState(DateTime.local().toISO())
  const [end, setEnd] = useState(DateTime.local().plus({ minutes: defaults.durationMin }).toISO())
  const [allDay, setAllDay] = useState(false)

  // tags / bring
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [checklist, setChecklist] = useState<string[]>([])
  const [bringInput, setBringInput] = useState('')

  // attendees + colour + responsibility
  const [attendees, setAttendees] = useState<string[]>([])
  const [attendeeInput, setAttendeeInput] = useState('')
  const [colour, setColour] = useState<string>(defaults.colour)
  const [responsibleAdult, setResponsibleAdult] = useState<string>('')

  // reminders
  const [remindersMin, setRemindersMin] = useState<number[]>(defaults.remindersMin.slice())

  // recurrence
  const [repeat, setRepeat] = useState<RepeatFreq>('none')
  const [interval, setInterval] = useState(1)
  const [byDays, setByDays] = useState<string[]>([])
  const [ends, setEnds] = useState<'never' | 'on' | 'after'>('never')
  const [until, setUntil] = useState<string>('') // yyyymmdd
  const [count, setCount] = useState<number>(10)
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('date')
  const [yearlyMode, setYearlyMode]   = useState<YearlyMode>('date')

  // edit scope
  const [editMode, setEditMode] = useState<'single' | 'following' | 'series'>('series')

  useEffect(() => {
    if (!open) return
    const e = initial
    const baseStart = DateTime.local().startOf('hour')

    setTitle(e?.title || '')
    setLocation(e?.location || '')
    setNotes(e?.notes || '')
    setStart(e?.start || baseStart.toISO())
    setEnd(e?.end || baseStart.plus({ minutes: defaults.durationMin }).toISO())
    setAllDay(!!e?.allDay)
    setTags(e?.tags || [])
    setChecklist(e?.checklist || [])
    setAttendees(e?.attendees || [])
    setColour(e?.colour || defaults.colour)
    setResponsibleAdult(((e as any)?.responsibleAdult as string) || '')
    setRemindersMin(((e as any)?.remindersMin as number[]) || defaults.remindersMin.slice())

    if (e?.rrule) {
      const up = e.rrule.toUpperCase()
      if (/FREQ=DAILY/.test(up)) setRepeat('daily')
      else if (/FREQ=WEEKLY/.test(up)) setRepeat('weekly')
      else if (/FREQ=MONTHLY/.test(up)) setRepeat('monthly')
      else if (/FREQ=YEARLY/.test(up)) setRepeat('yearly')
      else setRepeat('none')

      const m = up.match(/INTERVAL=(\d+)/)
      setInterval(m ? Math.max(1, parseInt(m[1], 10)) : 1)

      const days = up.match(/BYDAY=([A-Z,]+)/)
      setByDays(days ? days[1].split(',') : [])

      if (/UNTIL=/.test(up)) setEnds('on')
      else if (/COUNT=/.test(up)) setEnds('after')
      else setEnds('never')

      const u = up.match(/UNTIL=([0-9T]+)/)
      setUntil(u ? u[1].slice(0, 8) : '')
      const c = up.match(/COUNT=(\d+)/)
      setCount(c ? Math.max(1, parseInt(c[1], 10)) : 10)

      setMonthlyMode(/BYDAY=/.test(up) ? 'weekday' : 'date')
      setYearlyMode(/BYDAY=/.test(up) ? 'weekday' : 'date')

      setEditMode('single')
    } else {
      setRepeat('none'); setInterval(1); setByDays([]); setEnds('never'); setUntil(''); setCount(10)
      setMonthlyMode('date'); setYearlyMode('date'); setEditMode('series')
    }
  }, [open, initial, defaults])

  // timezone-aware conversion for datetime-local inputs
  const toLocalInput = (iso: string) => DateTime.fromISO(iso).setZone(timezone).toFormat("yyyy-LL-dd'T'HH:mm")
  const fromLocalInput = (local: string) =>
    DateTime.fromFormat(local, "yyyy-LL-dd'T'HH:mm", { zone: timezone }).toISO()

  const startDT = useMemo(() => DateTime.fromISO(start), [start])
  const endDT   = useMemo(() => DateTime.fromISO(end),   [end])
  const duration = useMemo(() => endDT.diff(startDT, 'minutes').minutes || defaults.durationMin, [startDT, endDT, defaults.durationMin])

  const setDuration = (mins: number) => setEnd(DateTime.fromISO(start).plus({ minutes: mins }).toISO())

  // helpers
  const addTag    = (t: string) => { const v = t.trim(); if (v && !tags.includes(v)) setTags([...tags, v]) }
  const removeTag = (t: string) => setTags(tags.filter(x => x !== t))
  const addBring    = (t: string) => { const v = t.trim(); if (v && !checklist.includes(v)) setChecklist([...checklist, v]) }
  const removeBring = (t: string) => setChecklist(checklist.filter(x => x !== t))

  const toggleMember = (name: string) =>
    setAttendees(prev => prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name])

  const addAttendee = (s: string) => { const v = s.trim(); if (v && !attendees.includes(v)) setAttendees(prev => [...prev, v]) }
  const removeAttendee = (s: string) => setAttendees(prev => prev.filter(a => a !== s))
  const toggleByDay = (code: string) => setByDays(prev => prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code])

  // Monthly/Yearly helpers
  const nthInMonth = (dt: DateTime) => Math.ceil(dt.day / 7) // 1..5
  const weekdayCode = (dt: DateTime) => WEEKDAY_CODES[dt.weekday - 1]
  const monthNum = (dt: DateTime) => dt.month // 1..12

  const buildRRule = (): string | undefined => {
    if (repeat === 'none') return undefined
    const dtStart = DateTime.fromISO(start)
    const parts = [`FREQ=${repeat.toUpperCase()}`, `INTERVAL=${Math.max(1, interval)}`]

    if (repeat === 'weekly') {
      const wd = byDays.length ? byDays : [weekdayCode(dtStart)]
      parts.push(`BYDAY=${wd.join(',')}`)
    }

    if (repeat === 'monthly') {
      if (monthlyMode === 'date') {
        // same day-of-month (DRIVEN BY DTSTART)
      } else {
        parts.push(`BYDAY=${weekdayCode(dtStart)}`)
        parts.push(`BYSETPOS=${nthInMonth(dtStart)}`)
      }
    }

    if (repeat === 'yearly') {
      parts.push(`BYMONTH=${monthNum(dtStart)}`)
      if (yearlyMode === 'weekday') {
        parts.push(`BYDAY=${weekdayCode(dtStart)}`)
        parts.push(`BYSETPOS=${nthInMonth(dtStart)}`)
      }
    }

    if (ends === 'on' && until) parts.push(`UNTIL=${until.replaceAll('-', '').slice(0, 8)}`)
    if (ends === 'after') parts.push(`COUNT=${Math.max(1, count)}`)
    return parts.join(';')
  }

  // ------- SAVE -------
  const onSubmit = () => {
    if (!title.trim()) { alert('Please enter a title'); return }
    if (!(startDT.isValid && endDT.isValid)) { alert('Please choose valid start and end times'); return }
    if (endDT <= startDT) { alert('End time must be after start time'); return }

    const payload: EventRecord = {
      ...(initial || {}),
      title: title.trim(),
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      start,
      end,
      allDay,
      tags,
      checklist,
      attendees,
      colour,
      rrule: buildRRule(),
      ...(responsibleAdult ? { responsibleAdult } : {}),
      ...(remindersMin.length ? { remindersMin } : {}),
    } as any

    // NEW: external events are saved via events-agenda (creates/updates a local shadow if allowed)
    if (initial && isExternal(initial)) {
      upsertAgendaEvent(payload)
      onClose()
      return
    }

    // Local/baseline events → keep your existing series handling
    onSave(payload, initial?.rrule ? editMode : 'series')
  }

  // ------- DELETE -------
  const onDelete = () => {
    if (!initial?.id) return
    if (!window.confirm('Delete this event? This cannot be undone.')) return

    // NEW: external/shadow delete → revert local edit or no-op on feed
    if (isExternal(initial) || isShadow(initial)) {
      deleteAgendaEvent(initial.id)
      onClose()
      return
    }

    // Local → your existing delete with series scope
    deleteLocalEvent({ ...initial, start, end } as EventRecord, initial.rrule ? editMode : 'series')
    onClose()
  }

  const onAllDayToggle = (checked: boolean) => {
    setAllDay(checked)
    const s = DateTime.fromISO(start)
    if (checked) {
      const dayStart = s.startOf('day')
      setStart(dayStart.toISO()); setEnd(dayStart.plus({ hours: 23, minutes: 59 }).toISO())
    } else {
      if (Duration.fromMillis(endDT.diff(startDT).milliseconds).as('hours') > 20) {
        const base = DateTime.local().startOf('hour')
        setStart(base.toISO()); setEnd(base.plus({ minutes: defaults.durationMin }).toISO())
      }
    }
  }

  if (!open) return null

  const adultOptions = members.filter(m => m.role === 'parent' || m.role === 'adult').map(m => m.name)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Event editor">
      <div className="modal modern">
        <header className="modal-h">
          <h3>{initial?.id ? 'Edit event' : 'Add event'}</h3>

          {/* NEW: external source badge (shows colour + name + edited if shadow) */}
          {external && (
            <span
              title={meta.name ? `From ${meta.name}` : 'External calendar'}
              style={{
                display:'inline-flex', alignItems:'center', gap:6, fontSize:11,
                padding:'2px 6px', borderRadius:999, background:'rgba(0,0,0,0.06)', marginLeft:8
              }}
            >
              <span style={{ width:8, height:8, borderRadius:999, background: meta.color || '#64748b' }} />
              <span>{meta.name || 'External'}</span>
              {shadow && <span style={{ opacity:0.7 }}>· edited</span>}
            </span>
          )}

          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto' }}>×</button>
        </header>

        <div className="modal-b" style={{ gap: '1rem' }}>
          {/* Title */}
          <label>
            Title
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Football training" autoFocus />
          </label>

          {/* Time row */}
          <div className="grid3">
            <label>
              Starts
              <input type="datetime-local" value={toLocalInput(start)} onChange={e => setStart(fromLocalInput(e.target.value)!)} />
            </label>
            <label>
              Ends
              <input type="datetime-local" value={toLocalInput(end)} onChange={e => setEnd(fromLocalInput(e.target.value)!)} />
            </label>
            <label className="row"><input type="checkbox" checked={allDay} onChange={e => onAllDayToggle(e.target.checked)} /> All day</label>
          </div>

          {/* Quick duration */}
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <span className="hint">Duration:</span>
            {DUR_PRESETS.map(p => (
              <button key={p.minutes} type="button" className={`chip ${duration === p.minutes ? 'active' : ''}`} onClick={() => setDuration(p.minutes)}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Location + Notes */}
          <div className="grid2">
            <label>Location<input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. School sports hall" /></label>
            <label>Notes<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" /></label>
          </div>

          {/* Event colour */}
          <section className="block">
            <div className="row between"><strong>Event colour</strong><span className="hint">Rules (Member → Tag → Role) can override.</span></div>
            <div className="row" style={{ alignItems: 'center', gap: '.5rem' }}>
              <input type="color" value={colour} onChange={e => setColour(e.target.value)} />
              <code className="hex">{colour}</code>
              <button onClick={() => setColour(defaults.colour)}>Reset</button>
            </div>
          </section>

          {/* Attendees */}
          <section className="block">
            <div className="row between"><strong>Attendees</strong><span className="hint">Select household members or add emails.</span></div>
            {members.length > 0 ? (
              <div className="chips selectable" style={{ marginBottom: '.5rem' }}>
                {members.map(m => {
                  const on = attendees.includes(m.name)
                  return (
                    <button key={m.id} className={`chip ${on ? 'active' : ''}`} title={m.email || ''} onClick={() => toggleMember(m.name)}>
                      {m.name}
                    </button>
                  )
                })}
              </div>
            ) : <p className="hint">No members yet. Add them in Settings → Members.</p>}

            <div className="row">
              <input
                placeholder="Add attendee email"
                value={attendeeInput}
                onChange={e => setAttendeeInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (isEmail(attendeeInput)) { addAttendee(attendeeInput); setAttendeeInput('') }
                    else alert('Please enter a valid email address')
                  }
                }}
              />
              <button onClick={() => { if (isEmail(attendeeInput)) { addAttendee(attendeeInput); setAttendeeInput('') } else alert('Please enter a valid email address') }}>
                Add
              </button>
            </div>

            {attendees.length > 0 && (
              <div className="chips" style={{ marginTop: '.5rem' }}>
                {attendees.map(a => (
                  <span className="chip" key={a}>{a}<button className="chip-x" onClick={() => removeAttendee(a)} aria-label={`Remove ${a}`}>×</button></span>
                ))}
              </div>
            )}
          </section>

          {/* Responsible adult */}
          <section className="card" style={{ padding: '.6rem' }}>
            <strong>Responsible adult</strong>
            <div className="row" style={{ marginTop: '.35rem' }}>
              <select value={responsibleAdult} onChange={e => setResponsibleAdult(e.target.value)}>
                <option value="">Not required / None</option>
                {members.filter(m => m.role === 'parent' || m.role === 'adult').map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
              {responsibleAdult && <span className="hint">They’ll see this in their agenda.</span>}
            </div>
          </section>

          {/* Tags */}
          <section className="block">
            <div className="row between"><strong>Tags</strong><span className="hint">Pick from presets or add your own</span></div>
            <div className="chips selectable">
              {presetTags.map(t => (
                <button key={t} className={`chip ${tags.includes(t) ? 'active' : ''}`} onClick={() => (tags.includes(t) ? removeTag(t) : addTag(t))}>{t}</button>
              ))}
            </div>
            <div className="row">
              <input
                placeholder="Add a custom tag"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { addTag(tagInput); setTagInput('') } }}
              />
              <button onClick={() => { addTag(tagInput); setTagInput('') }}>Add</button>
            </div>
            {tags.length > 0 && (
              <div className="chips">
                {tags.map(t => (
                  <span className="chip" key={t}>{t}<button className="chip-x" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}>×</button></span>
                ))}
              </div>
            )}
          </section>

          {/* What to bring */}
          <section className="block">
            <div className="row between"><strong>What to bring</strong><span className="hint">Select from presets or add items</span></div>
            <div className="chips selectable">
              {bringPresets.map(t => (
                <button key={t} className={`chip ${checklist.includes(t) ? 'active' : ''}`} onClick={() => (checklist.includes(t) ? removeBring(t) : addBring(t))}>{t}</button>
              ))}
            </div>
            <div className="row">
              <input
                placeholder="Add an item"
                value={bringInput}
                onChange={e => setBringInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { addBring(bringInput); setBringInput('') } }}
              />
              <button onClick={() => { addBring(bringInput); setBringInput('') }}>Add</button>
            </div>
            {checklist.length > 0 && (
              <div className="chips">
                {checklist.map(t => (
                  <span className="chip" key={t}>{t}<button className="chip-x" onClick={() => removeBring(t)} aria-label={`Remove ${t}`}>×</button></span>
                ))}
              </div>
            )}
          </section>

          {/* Reminders */}
          <section className="block">
            <strong>Reminders</strong>
            <div className="row" style={{ gap: '.5rem', flexWrap: 'wrap', marginTop: '.35rem' }}>
              {[0, 5, 10, 15, 30, 60, 120, 1440].map(m => {
                const on = remindersMin.includes(m)
                return (
                  <button
                    key={m}
                    className={`chip ${on ? 'active' : ''}`}
                    onClick={() => setRemindersMin(prev => on ? prev.filter(x => x !== m) : [...prev, m].sort((a,b)=>a-b))}
                  >
                    {m === 0 ? 'At start' : `${m} min`}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Repeat */}
          <section className="block">
            <strong>Repeat</strong>
            <div className="grid3">
              <label>
                Frequency
                <select value={repeat} onChange={e => setRepeat(e.target.value as RepeatFreq)}>
                  <option value="none">Doesn’t repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <label>
                Repeat every (interval)
                <input type="number" min={1} value={interval} onChange={e => setInterval(Math.max(1, parseInt(e.target.value || '1', 10)))} />
              </label>

              {repeat === 'weekly' && (
                <div>
                  Days
                  <div className="days">
                    {WEEKDAY_LABELS.map((d, idx) => {
                      const code = WEEKDAY_CODES[idx]
                      const on = byDays.includes(code)
                      return <button key={code} className={`day ${on ? 'on' : ''}`} onClick={() => toggleByDay(code)}>{d}</button>
                    })}
                  </div>
                </div>
              )}

              {repeat === 'monthly' && (
                <div>
                  Pattern
                  <div className="days">
                    <button className={`day ${monthlyMode === 'date' ? 'on' : ''}`} onClick={() => setMonthlyMode('date')}>
                      Same date (e.g. {DateTime.fromISO(start).toFormat('d')})
                    </button>
                    <button className={`day ${monthlyMode === 'weekday' ? 'on' : ''}`} onClick={() => setMonthlyMode('weekday')}>
                      {nthLabel(DateTime.fromISO(start))} {DateTime.fromISO(start).toFormat('cccc')}
                    </button>
                  </div>
                </div>
              )}

              {repeat === 'yearly' && (
                <div>
                  Pattern
                  <div className="days">
                    <button className={`day ${yearlyMode === 'date' ? 'on' : ''}`} onClick={() => setYearlyMode('date')}>
                      Same date each year
                    </button>
                    <button className={`day ${yearlyMode === 'weekday' ? 'on' : ''}`} onClick={() => setYearlyMode('weekday')}>
                      {nthLabel(DateTime.fromISO(start))} {DateTime.fromISO(start).toFormat('cccc')} in {DateTime.fromISO(start).toFormat('LLLL')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {repeat !== 'none' && (
              <div className="grid3">
                <label>
                  Ends
                  <select value={ends} onChange={e => setEnds(e.target.value as any)}>
                    <option value="never">Never</option>
                    <option value="on">On date</option>
                    <option value="after">After N times</option>
                  </select>
                </label>
                {ends === 'on' && (
                  <label>
                    Until
                    <input
                      type="date"
                      value={until ? DateTime.fromFormat(until, 'yyyyLLdd').toFormat('yyyy-LL-dd') : ''}
                      onChange={e => setUntil(e.target.value ? DateTime.fromISO(e.target.value).toFormat('yyyyLLdd') : '')}
                    />
                  </label>
                )}
                {ends === 'after' && (
                  <label>
                    Count
                    <input type="number" min={1} value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value || '1', 10)))} />
                  </label>
                )}
              </div>
            )}
          </section>

          {/* Apply to… */}
          {initial?.rrule && (
            <section className="block">
              <strong>Apply changes to</strong>
              <div className="row gap">
                <label><input type="radio" name="em" checked={editMode === 'single'} onChange={() => setEditMode('single')} /> This occurrence only</label>
                <label><input type="radio" name="em" checked={editMode === 'following'} onChange={() => setEditMode('following')} /> This and following</label>
                <label><input type="radio" name="em" checked={editMode === 'series'} onChange={() => setEditMode('series')} /> Entire series</label>
              </div>
            </section>
          )}
        </div>

        <footer className="modal-f">
          <div className="row" style={{ gap: '0.5rem' }}>
            {initial?.id && (
              <button onClick={onDelete} style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}>
                Delete
              </button>
            )}
            <button onClick={onClose}>Cancel</button>
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="primary" onClick={onSubmit}>Save</button>
          </div>
        </footer>
      </div>
    </div>
  )

  function nthLabel(dt: DateTime) {
    const n = Math.ceil(dt.day / 7)
    return ['1st','2nd','3rd','4th','5th'][n-1] || `${n}th`
  }
}
