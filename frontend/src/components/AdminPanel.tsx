// frontend/src/components/AdminPanel.tsx
import React, { useMemo, useState } from 'react'
import { useSettings } from '../state/settings'

const Chip: React.FC<{ label: string; onRemove?: () => void; title?: string }> = ({ label, onRemove, title }) => (
  <span className="chip" title={title}>
    {label}
    {onRemove && (<button className="chip-x" aria-label={`Remove ${label}`} onClick={onRemove}>×</button>)}
  </span>
)

type Role = 'parent' | 'adult' | 'child' | 'guest'

export default function AdminPanel() {
  const settings = useSettings()

  /* ---------------- Members ---------------- */
  const [mName, setMName] = useState('')
  const [mRole, setMRole] = useState<Role>('parent')
  const [mEmail, setMEmail] = useState('')
  const [mColour, setMColour] = useState('#5b9bd5')

  const addMember = () => {
    const name = mName.trim()
    if (!name) return
    settings.addMember({ name, role: mRole, email: mEmail.trim() || undefined, colour: mColour })
    setMName(''); setMEmail(''); setMColour('#5b9bd5'); setMRole('parent')
  }

  // lightweight inline editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<Role>('parent')
  const [editEmail, setEditEmail] = useState('')
  const [editColour, setEditColour] = useState('#5b9bd5')

  const startEdit = (id: string) => {
    const m = settings.members.find(x => x.id === id)
    if (!m) return
    setEditingId(id)
    setEditName(m.name)
    setEditRole(m.role as Role)
    setEditEmail(m.email || '')
    setEditColour(m.colour || '#5b9bd5')
  }
  const commitEdit = () => {
    if (!editingId) return
    settings.updateMember(editingId, {
      name: editName.trim() || 'Unnamed',
      role: editRole,
      email: editEmail.trim() || undefined,
      colour: editColour,
    })
    setEditingId(null)
  }

  const membersByRole = useMemo(() => {
    const groups: Record<Role, typeof settings.members> = { parent: [], adult: [], child: [], guest: [] }
    for (const m of settings.members) groups[m.role as Role]?.push(m)
    return groups
  }, [settings.members])

  /* ---------------- Tags ---------------- */
  const [newTag, setNewTag] = useState('')
  const addTag = () => { const v = newTag.trim(); if (!v) return; settings.addTag(v); setNewTag('') }

  /* ---------------- Bring presets ---------------- */
  const [newBring, setNewBring] = useState('')
  const addBring = () => { const v = newBring.trim(); if (!v) return; settings.addBringPreset(v); setNewBring('') }

  /* ---------------- Colour rules ---------------- */
  const [ruleScope, setRuleScope] = useState<'member' | 'tag' | 'role'>('tag')
  const [ruleKey, setRuleKey] = useState('')
  const [ruleColour, setRuleColour] = useState('#5b9bd5')
  const addRule = () => { const k = ruleKey.trim(); if (!k) return; settings.addColourRule({ scope: ruleScope, key: k, colour: ruleColour }); setRuleKey('') }

  return (
    <div className="admin">
      <h2>Settings</h2>

      {/* General */}
      <section className="card">
        <h3>General</h3>
        <div className="grid3">
          <label>
            Theme
            <select
              value={settings.theme}
              onChange={e => settings.setTheme(e.target.value as any)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <label className="row">
            <input
              type="checkbox"
              checked={settings.denseHours}
              onChange={e => settings.setDenseHours(e.target.checked)}
            />
            Dense hours
          </label>

          <label className="row">
            <input
              type="checkbox"
              checked={settings.weekStartMonday}
              onChange={e => settings.setWeekStartMonday(e.target.checked)}
            />
            Week starts Monday
          </label>
        </div>
        <p className="hint">“Dense hours” compresses vertical spacing in day/week views.</p>
      </section>

      {/* Members */}
      <section className="card">
        <h3>Members</h3>
        <p className="hint">Create your household members. You can pick these as attendees when adding events. Roles are used for colour rules and future permissions.</p>

        <div className="grid3" style={{ alignItems: 'end' }}>
          <label>
            Name
            <input
              placeholder="e.g. Ernie"
              value={mName}
              onChange={e => setMName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMember()}
            />
          </label>
          <label>
            Role
            <select value={mRole} onChange={e => setMRole(e.target.value as Role)}>
              <option value="parent">Parent</option>
              <option value="adult">Adult</option>
              <option value="child">Child</option>
              <option value="guest">Guest</option>
            </select>
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              placeholder="name@example.com"
              value={mEmail}
              onChange={e => setMEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMember()}
            />
          </label>
          <label>
            Colour
            <input type="color" value={mColour} onChange={e => setMColour(e.target.value)} />
          </label>
          <div className="row">
            <button onClick={addMember} className="primary">Add member</button>
          </div>
        </div>

        {/* Listing */}
        {(['parent','adult','child','guest'] as Role[]).map(role => (
          membersByRole[role].length > 0 && (
            <div key={role} style={{ marginTop: '.75rem' }}>
              <h4 style={{ margin: '0 0 .4rem' }}>{role[0].toUpperCase() + role.slice(1)}</h4>
              <ul className="rules">
                {membersByRole[role].map(m => (
                  <li key={m.id} className="rule" style={{ flexWrap: 'wrap' }}>
                    {editingId === m.id ? (
                      <>
                        <input value={editName} onChange={e => setEditName(e.target.value)} />
                        <select value={editRole} onChange={e => setEditRole(e.target.value as Role)}>
                          <option value="parent">Parent</option>
                          <option value="adult">Adult</option>
                          <option value="child">Child</option>
                          <option value="guest">Guest</option>
                        </select>
                        <input
                          type="email"
                          placeholder="email"
                          value={editEmail}
                          onChange={e => setEditEmail(e.target.value)}
                          style={{ minWidth: 180 }}
                        />
                        <input type="color" value={editColour} onChange={e => setEditColour(e.target.value)} />
                        <button className="primary" onClick={commitEdit}>Save</button>
                        <button onClick={() => setEditingId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="pill">{m.role}</span>
                        <span className="key">{m.name}</span>
                        {m.email && <span className="hint">({m.email})</span>}
                        <span className="preview" style={{ background: m.colour || '#cbd5e1' }} />
                        {m.colour && <code className="hex">{m.colour}</code>}
                        <button onClick={() => startEdit(m.id!)}>Edit</button>
                        <button onClick={() => settings.removeMember(m.id!)}>Remove</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        ))}
      </section>

      {/* Tags */}
      <section className="card">
        <h3>Tags</h3>
        <div className="row">
          <input
            aria-label="Add tag"
            placeholder="Add a tag"
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTag()}
          />
          <button onClick={addTag}>Add</button>
        </div>
        <div className="chips">
          {settings.tags.map(t => (
            <Chip key={t} label={t} onRemove={() => settings.removeTag(t)} />
          ))}
        </div>
      </section>

      {/* What to bring */}
      <section className="card">
        <h3>What to bring — presets</h3>
        <p className="hint">These appear as quick-select chips in the event modal. You can still add free text per event.</p>
        <div className="row">
          <input
            aria-label="Add preset"
            placeholder="Add a preset item"
            value={newBring}
            onChange={e => setNewBring(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addBring()}
          />
          <button onClick={addBring}>Add</button>
        </div>
        <div className="chips">
          {settings.bringPresets.map(item => (
            <Chip key={item} label={item} onRemove={() => settings.removeBringPreset(item)} />
          ))}
        </div>
      </section>

      {/* Colour rules */}
      <section className="card">
        <h3>Colour rules</h3>
        <p className="hint">Forced colours by <strong>Member → Tag → Role</strong> priority.</p>
        <div className="grid3">
          <label>
            Scope
            <select value={ruleScope} onChange={e => setRuleScope(e.target.value as any)}>
              <option value="member">Member</option>
              <option value="tag">Tag</option>
              <option value="role">Role</option>
            </select>
          </label>
          <label>
            Key
            <input
              placeholder="e.g. Ernie / School / parent"
              value={ruleKey}
              onChange={e => setRuleKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRule()}
            />
          </label>
          <label>
            Colour
            <input type="color" value={ruleColour} onChange={e => setRuleColour(e.target.value)} />
          </label>
        </div>

        <ul className="rules">
          {settings.colourRules.map(r => (
            <li key={r.id} className="rule">
              <span className="pill">{r.scope}</span>
              <span className="key">{r.key}</span>
              <span className="preview" style={{ background: r.colour }} />
              <code className="hex">{r.colour}</code>
              <button onClick={() => settings.removeColourRule(r.id)} aria-label={`Remove rule ${r.key}`}>Remove</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
