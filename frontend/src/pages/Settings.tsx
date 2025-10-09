// frontend/src/pages/Settings.tsx
import React, { useState } from 'react'
import { useSettings, Member, MemberRole } from '../state/settings'
import { featureFlags } from '../state/featureFlags'
import GoogleConnectCard from '../components/integrations/GoogleConnectCard'

export default function SettingsPage() {
  const s = useSettings()

  // --- local state for Household + Tags / Checklist ---
  const [editing, setEditing] = useState<Member | null>(null)
  const [draft, setDraft] = useState<Partial<Member>>({})
  const [tagInput, setTagInput] = useState('')
  const [bringInput, setBringInput] = useState('')

  // --- helpers -------------------------------------------------------------
  const resetDraft = () => { setEditing(null); setDraft({}) }

  const saveMember = () => {
    const name = (draft.name || '').trim()
    if (!name) return alert('Please enter a name')
    const role = (draft.role || 'child') as MemberRole
    const colour = draft.colour || '#2F80ED'
    const email = draft.email?.trim() || undefined

    if (editing) s.updateMember(editing.id, { name, role, colour, email })
    else s.addMember({ name, role, colour, email })
    resetDraft()
  }

  const removeTag = (t: string) =>
    s.setTags((s.tags || []).filter(x => x !== t))

  const removeBring = (t: string) =>
    s.setChecklist((s.checklist || []).filter(x => x !== t))

  const handleTagAdd = () => {
    const val = tagInput.trim()
    if (val) s.setTags([...(s.tags || []), val])
    setTagInput('')
  }

  const handleBringAdd = () => {
    const val = bringInput.trim()
    if (val) s.setChecklist([...(s.checklist || []), val])
    setBringInput('')
  }

  // --- render --------------------------------------------------------------
  return (
    <div className="settings-page">
      <h2>Settings</h2>

      {/* ==== Appearance =================================================== */}
      <div className="card">
        <h3>Appearance</h3>
        <div className="grid3">
          <label>
            Theme
            <select value={s.theme} onChange={e => s.setTheme(e.target.value as any)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto</option>
            </select>
          </label>

          <label>
            Timezone
            <select value={s.timezone} onChange={e => s.setTimezone(e.target.value)}>
              {Intl.supportedValuesOf
                ? Intl.supportedValuesOf('timeZone').map(tz =>
                    <option key={tz} value={tz}>{tz}</option>
                  )
                : <option>{s.timezone}</option>}
            </select>
          </label>

          <label>
            Week starts on
            <select
              value={s.weekStartMonday ? 'Mon' : 'Sun'}
              onChange={e => s.setWeekStart(e.target.value === 'Mon')}
            >
              <option>Mon</option>
              <option>Sun</option>
            </select>
          </label>
        </div>
      </div>

      {/* ==== Household ===================================================== */}
      <div className="card">
        <h3>Household Members</h3>
        <div className="grid2">
          <div>
            <ul className="list">
              {s.members.map(m => (
                <li key={m.id} className="row">
                  <div className="row-left">
                    <span className="dot" style={{ background: m.colour || '#888' }} />
                    <strong>{m.name}</strong> <small>· {m.role}</small>
                    {m.email ? <small> · {m.email}</small> : null}
                  </div>
                  <div className="row-right">
                    <button onClick={() => { setEditing(m); setDraft(m) }} className="btn btn-small">Edit</button>
                    <button onClick={() => s.removeMember(m.id)} className="btn btn-small btn-danger">Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>{editing ? 'Edit member' : 'Add member'}</h4>
            <div className="form-grid">
              <label>Name
                <input
                  value={draft.name || ''}
                  onChange={e => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Name"
                />
              </label>

              <label>Role
                <select
                  value={draft.role || 'child'}
                  onChange={e => setDraft({ ...draft, role: e.target.value as MemberRole })}
                >
                  <option value="parent">Parent</option>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                </select>
              </label>

              <label>Colour
                <input
                  type="color"
                  value={draft.colour || '#2F80ED'}
                  onChange={e => setDraft({ ...draft, colour: e.target.value })}
                />
              </label>

              <label>Email (optional)
                <input
                  value={draft.email || ''}
                  onChange={e => setDraft({ ...draft, email: e.target.value })}
                  placeholder="user@email.com"
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button onClick={saveMember} className="btn">{editing ? 'Save' : 'Add'}</button>
              {editing && <button onClick={resetDraft} className="btn btn-secondary">Cancel</button>}
            </div>
          </div>
        </div>
      </div>

      {/* ==== Tags & Checklist ============================================= */}
      <div className="card">
        <h3>Tags &amp; What to Bring</h3>
        <div className="grid2">
          {/* Tags */}
          <div>
            <h4>Common Tags</h4>
            <div className="pill-row">
              {(s.tags || []).map(t => (
                <span key={t} className="pill" onClick={() => removeTag(t)}>{t} ×</span>
              ))}
            </div>
            <div className="row">
              <input
                placeholder="Add tag"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTagAdd()}
              />
              <button onClick={handleTagAdd} className="btn">Add</button>
            </div>
          </div>

          {/* Checklist */}
          <div>
            <h4>What to Bring</h4>
            <div className="pill-row">
              {(s.checklist || []).map(t => (
                <span key={t} className="pill" onClick={() => removeBring(t)}>{t} ×</span>
              ))}
            </div>
            <div className="row">
              <input
                placeholder="Add item"
                value={bringInput}
                onChange={e => setBringInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleBringAdd()}
              />
              <button onClick={handleBringAdd} className="btn">Add</button>
            </div>
          </div>
        </div>
      </div>

      {/* ==== Integrations ================================================== */}
      <div className="card">
        <h3>Integrations</h3>
        {featureFlags.get().google && <GoogleConnectCard />}
        {/* Existing integrations / ICS imports remain unchanged */}
        {!featureFlags.get().google && (
          <div className="muted">Enable Google in featureFlags to show Calendar connection.</div>
        )}
      </div>
    </div>
  )
}
