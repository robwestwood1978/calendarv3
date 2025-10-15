// frontend/src/components/SettingsPage.tsx
// Restored Baseline-D Settings UI with proper pill chips for Tags & What to Bring.

import React, { useMemo, useState } from 'react'
import { useSettings, Member, MemberRole } from '../state/settings'

const ROLES: MemberRole[] = ['parent', 'adult', 'child'] as const

export default function SettingsPage() {
  const s = useSettings()

  // Household edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Member>>({})

  // Inputs for tags & bring presets
  const [tagInput, setTagInput] = useState('')
  const [bringInput, setBringInput] = useState('')

  const tzOptions = useMemo(() => {
    try {
      // @ts-ignore
      const list = typeof Intl !== 'undefined' && Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []
      return (list && list.length ? list : [s.timezone]).filter(Boolean) as string[]
    } catch {
      return [s.timezone].filter(Boolean) as string[]
    }
  }, [s.timezone])

  function startEdit(m: Member) {
    setEditingId(m.id)
    setDraft({ name: m.name, role: m.role, colour: m.colour || '#2F80ED', email: m.email || '' })
  }
  function cancelEdit() {
    setEditingId(null)
    setDraft({})
  }
  function saveMember() {
    const name = (draft.name || '').trim()
    if (!name) return alert('Please enter a name')
    const role = (draft.role || 'child') as MemberRole
    const colour = draft.colour || '#2F80ED'
    const email = (draft.email || '').trim() || undefined

    if (editingId) s.updateMember(editingId, { name, role, colour, email })
    else s.addMember({ name, role, colour, email })
    cancelEdit()
  }

  // Tags / Bring
  function addTag() {
    const v = tagInput.trim()
    if (!v) return
    s.addTag(v)
    setTagInput('')
  }
  function addBring() {
    const v = bringInput.trim()
    if (!v) return
    s.addBring(v)
    setBringInput('')
  }

  return (
    <div className="settings-page">
      {/* Google section (kept minimal; your existing toggle/buttons live elsewhere) */}
      <div className="card">
        <h3>Google Calendar</h3>
        <p style={{ marginTop: 0 }}>
          Status: <strong>{s?.integrations?.google?.connected ? 'Connected' : 'Not connected'}</strong>
        </p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={!!s?.integrations?.google?.trace}
            onChange={e => s.setIntegrationTrace?.('google', e.target.checked)}
          />
          <span>Developer trace</span>
        </label>
      </div>

      {/* Appearance */}
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
              {tzOptions.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </label>

          <label>
            Week starts on
            <select value={s.weekStartMonday ? 'Mon' : 'Sun'} onChange={e => s.setWeekStart(e.target.value === 'Mon')}>
              <option>Mon</option>
              <option>Sun</option>
            </select>
          </label>
        </div>
      </div>

      {/* Household */}
      <div className="card">
        <h3>Household</h3>
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
                    <button className="btn btn-small" onClick={() => startEdit(m)}>Edit</button>
                    <button className="btn btn-small btn-danger" onClick={() => s.removeMember(m.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 style={{ marginTop: 0 }}>{editingId ? 'Edit member' : 'Add member'}</h4>
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
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
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
                  placeholder="name@example.com"
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn" onClick={saveMember}>{editingId ? 'Save' : 'Add'}</button>
              {editingId && <button className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>}
            </div>
          </div>
        </div>
      </div>

      {/* Tags & What to Bring */}
      <div className="card">
        <h3>Tags &amp; What to Bring</h3>
        <div className="grid2">
          {/* Tags */}
          <div>
            <h4>Common Tags</h4>
            <div className="chips" style={{ marginTop: 6 }}>
              {(s.tags || []).map(tag => (
                <span key={tag} className="pill" role="listitem" aria-label={`Tag ${tag}`}>
                  <span className="pill-label">{tag}</span>
                  <button
                    className="pill-xbtn"
                    aria-label={`Remove ${tag}`}
                    onClick={() => s.removeTag(tag)}
                  >×</button>
                </span>
              ))}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                placeholder="Add tag"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTag()}
              />
              <button className="btn" onClick={addTag}>Add</button>
            </div>
          </div>

          {/* Bring presets */}
          <div>
            <h4>What to Bring</h4>
            <div className="chips" style={{ marginTop: 6 }}>
              {(s.bringPresets || []).map(item => (
                <span key={item} className="pill" role="listitem" aria-label={`Item ${item}`}>
                  <span className="pill-label">{item}</span>
                  <button
                    className="pill-xbtn"
                    aria-label={`Remove ${item}`}
                    onClick={() => s.removeBring(item)}
                  >×</button>
                </span>
              ))}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                placeholder="Add item"
                value={bringInput}
                onChange={e => setBringInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addBring()}
              />
              <button className="btn" onClick={addBring}>Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
