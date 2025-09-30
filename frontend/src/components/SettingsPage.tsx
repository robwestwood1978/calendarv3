// frontend/src/components/SettingsPage.tsx
import React, { useState } from 'react'
import { useSettings, Member, MemberRole } from '../state/settings'

const ROLES: MemberRole[] = ['parent', 'adult', 'child']
const THEMES = ['light', 'dark'] as const
const TZ_LIST = [
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Rome', 'America/New_York', 'America/Los_Angeles',
  'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
]

export default function SettingsPage() {
  const s = useSettings()

  const [tagInput, setTagInput] = useState('')
  const [bringInput, setBringInput] = useState('')
  const [memberDraft, setMemberDraft] = useState<Partial<Member>>({ role: 'child' })
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)

  const startEditMember = (m: Member) => {
    setEditingMemberId(m.id)
    setMemberDraft({ name: m.name, role: m.role, colour: m.colour, email: m.email })
  }
  const cancelEditMember = () => { setEditingMemberId(null); setMemberDraft({ role: 'child' }) }
  const saveMember = () => {
    const name = (memberDraft.name || '').trim()
    if (!name) { alert('Please enter a name'); return }
    const role = (memberDraft.role || 'child') as MemberRole
    const patch = { name, role, colour: memberDraft.colour || undefined, email: memberDraft.email || undefined }
    if (editingMemberId) s.updateMember(editingMemberId, patch)
    else s.addMember(patch)
    cancelEditMember()
  }

  return (
    <div className="admin" style={{ paddingBottom: 80 }}>
      <h2>Settings</h2>

      {/* Appearance */}
      <div className="card">
        <h3>Appearance</h3>
        <div className="grid3">
          <label>
            Theme
            <select value={s.theme} onChange={e => s.setTheme(e.target.value as any)}>
              {THEMES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </label>

          <div>
            <strong>Hour density</strong>
            <div className="row" style={{ marginTop: '.35rem' }}>
              <input id="denseHours" type="checkbox" checked={s.denseHours} onChange={e => s.setDense(e.target.checked)} />
              <label htmlFor="denseHours" style={{ userSelect: 'none', cursor: 'pointer' }}>Dense hours</label>
            </div>
          </div>

          <label>
            Font size
            <input type="range" min={0.9} max={1.2} step={0.05} value={s.fontScale}
                   onChange={e => s.setFontScale(parseFloat(e.target.value))} />
          </label>
        </div>

        <div className="grid3" style={{ marginTop: '.6rem' }}>
          <label>
            Timezone
            <select value={s.timezone} onChange={e => s.setTimezone(e.target.value)}>
              {TZ_LIST.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </label>

          <label>
            Default duration (minutes)
            <input type="number" min={15} step={15} value={s.defaults.durationMin}
                   onChange={e => s.setDefaults({ durationMin: Math.max(15, parseInt(e.target.value || '60', 10)) })} />
          </label>

          <label>
            Default event colour
            <div className="row">
              <input type="color" value={s.defaults.colour}
                     onChange={e => s.setDefaults({ colour: e.target.value })} />
              <code className="hex">{s.defaults.colour}</code>
            </div>
          </label>
        </div>

        <div className="row" style={{ marginTop: '.6rem', gap: '.5rem', flexWrap: 'wrap' }}>
          <span className="hint">Default reminders (minutes)</span>
          {[0, 5, 10, 15, 30, 60, 120, 1440].map(m => {
            const on = s.defaults.remindersMin.includes(m)
            return (
              <button key={m} className={`chip ${on ? 'active' : ''}`}
                      onClick={() => {
                        const has = s.defaults.remindersMin.includes(m)
                        s.setDefaults({ remindersMin: has
                          ? s.defaults.remindersMin.filter(x => x !== m)
                          : [...s.defaults.remindersMin, m].sort((a,b)=>a-b) })
                      }}>
                {m === 0 ? 'At start' : `${m} min`}
              </button>
            )
          })}
        </div>
      </div>

      {/* Members */}
      <div className="card">
        <h3>Household members</h3>
        <div className="grid3" style={{ alignItems: 'end' }}>
          <label>
            Name
            <input placeholder="e.g. Alex" value={memberDraft.name || ''} onChange={e => setMemberDraft(d => ({ ...d, name: e.target.value }))} />
          </label>
          <label>
            Role
            <select value={memberDraft.role || 'child'} onChange={e => setMemberDraft(d => ({ ...d, role: e.target.value as MemberRole }))}>
              {ROLES.map(r => <option key={r} value={r}>{cap(r)}</option>)}
            </select>
          </label>
          <label>
            Colour
            <div className="row">
              <input type="color" value={memberDraft.colour || '#1e88e5'} onChange={e => setMemberDraft(d => ({ ...d, colour: e.target.value }))} />
              <code className="hex">{memberDraft.colour || ''}</code>
            </div>
          </label>
        </div>
        <div className="grid2" style={{ marginTop: '.5rem', alignItems: 'end' }}>
          <label>
            Email (optional)
            <input type="email" placeholder="name@example.com" value={memberDraft.email || ''} onChange={e => setMemberDraft(d => ({ ...d, email: e.target.value }))} />
          </label>
          <div className="row" style={{ gap: '.5rem' }}>
            {editingMemberId && <button onClick={cancelEditMember}>Cancel</button>}
            <button className="primary" onClick={saveMember}>{editingMemberId ? 'Save changes' : 'Add member'}</button>
          </div>
        </div>

        <div className="chips" style={{ marginTop: '.75rem' }}>
          {s.members.map(m => (
            <span className="chip" key={m.id} title={m.email || ''}>
              <span className="rule preview" style={{ background: m.colour || '#ccc', width: 14, height: 14 }}></span>
              {m.name} • {cap(m.role)}
              <button className="chip-x" onClick={() => startEditMember(m)} aria-label={`Edit ${m.name}`}>✎</button>
              <button className="chip-x" onClick={() => s.removeMember(m.id)} aria-label={`Remove ${m.name}`}>×</button>
            </span>
          ))}
        </div>
      </div>

      {/* Presets */}
      <div className="card">
        <h3>Presets</h3>
        <div className="grid2">
          <div>
            <strong>Tags</strong>
            <div className="row" style={{ marginTop: '.35rem' }}>
              <input placeholder="Add a tag" value={tagInput} onChange={e => setTagInput(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') { s.addTag(tagInput); setTagInput('') } }} />
              <button onClick={() => { s.addTag(tagInput); setTagInput('') }}>Add</button>
            </div>
            <div className="chips" style={{ marginTop: '.5rem' }}>
              {s.tags.map(t => (
                <span key={t} className="chip">{t}<button className="chip-x" onClick={() => s.removeTag(t)} aria-label={`Remove ${t}`}>×</button></span>
              ))}
            </div>
          </div>

          <div>
            <strong>What to bring</strong>
            <div className="row" style={{ marginTop: '.35rem' }}>
              <input placeholder="Add an item" value={bringInput} onChange={e => setBringInput(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') { s.addBring(bringInput); setBringInput('') } }} />
              <button onClick={() => { s.addBring(bringInput); setBringInput('') }}>Add</button>
            </div>
            <div className="chips" style={{ marginTop: '.5rem' }}>
              {s.bringPresets.map(t => (
                <span key={t} className="chip">{t}<button className="chip-x" onClick={() => s.removeBring(t)} aria-label={`Remove ${t}`}>×</button></span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Colour rules */}
      <div className="card">
        <h3>Colour rules</h3>
        <p className="hint" style={{ marginTop: '-.25rem' }}>
          Colour is chosen by the first match: <strong>Member</strong> → <strong>Tag</strong> → <strong>Role</strong> → event’s own colour.
          Use Member to keep a child’s colour across their activities; Tag to override (e.g. “Medical”).
        </p>

        <RuleBuilder />
        <div style={{ marginTop: '.75rem' }}>
          {s.colourRules.length === 0 && <p className="hint">No rules yet. Add some above.</p>}
          {s.colourRules.map(r => (
            <div key={r.id} className="rule">
              <span className="pill">{cap(r.type)}</span>
              <span>{r.value}</span>
              <span className="preview" style={{ background: r.colour }}></span>
              <code className="hex">{r.colour}</code>
              <button className="chip-x" onClick={() => s.removeRule(r.id)} aria-label="Remove rule">×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  function RuleBuilder() {
    const [type, setType] = useState<'member' | 'tag' | 'role'>('member')
    const [value, setValue] = useState('')
    const [colour, setColour] = useState('#1e88e5')

    return (
      <>
        <div className="grid3" style={{ marginTop: '.5rem', alignItems: 'end' }}>
          <label>
            Rule type
            <select value={type} onChange={e => { setType(e.target.value as any); setValue('') }}>
              <option value="member">Member</option>
              <option value="tag">Tag</option>
              <option value="role">Role</option>
            </select>
          </label>
          <label>
            {type === 'member' ? 'Member' : type === 'tag' ? 'Tag' : 'Role'}
            {type === 'member' && (
              <select value={value} onChange={e => setValue(e.target.value)}>
                <option value="">Select member…</option>
                {s.members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            )}
            {type === 'tag' && (
              <select value={value} onChange={e => setValue(e.target.value)}>
                <option value="">Select tag…</option>
                {s.tags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {type === 'role' && (
              <select value={value} onChange={e => setValue(e.target.value)}>
                <option value="">Select role…</option>
                {ROLES.map(r => <option key={r} value={r}>{cap(r)}</option>)}
              </select>
            )}
          </label>
          <label>
            Colour
            <div className="row">
              <input type="color" value={colour} onChange={e => setColour(e.target.value)} />
              <code className="hex">{colour}</code>
            </div>
          </label>
        </div>
        <div className="row" style={{ marginTop: '.5rem' }}>
          <button className="primary" onClick={() => {
            const v = value.trim()
            if (!v) { alert('Please choose a value for the rule'); return }
            s.addRule({ type, value: v, colour })
            setValue('')
          }}>Add rule</button>
        </div>
      </>
    )
  }
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
