// frontend/src/components/SettingsPage.tsx
import React, { useState } from 'react'
import { useSettings, Member, MemberRole } from '../state/settings'
import { featureFlags } from '../state/featureFlags'
import GoogleConnectCard from './integrations/GoogleConnectCard'
import IntegrationsPanel from './integrations/IntegrationsPanel'

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

  const removeTag = (t: string) => s.setTags((s.tags || []).filter(x => x !== t))
  const removeBring = (t: string) => s.setChecklist((s.checklist || []).filter(x => x !== t))

  return (
    <div className="settings-page">
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
            <label>Timezone</label>
            <select value={s.timezone} onChange={e => s.setTimezone(e.target.value)}>
              {TZ_LIST.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <div>
            <label>Week starts on</label>
            <select value={s.weekStartMonday ? 'Mon' : 'Sun'} onChange={e => s.setWeekStart(e.target.value === 'Mon')}>
              <option>Mon</option>
              <option>Sun</option>
            </select>
          </div>
        </div>
      </div>

      {/* Household members */}
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
                    <button onClick={() => startEditMember(m)} className="btn btn-small">Edit</button>
                    <button onClick={() => s.removeMember(m.id)} className="btn btn-small btn-danger">Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4>{editingMemberId ? 'Edit member' : 'Add member'}</h4>
            <div className="form-grid">
              <label>Name<input value={memberDraft.name || ''} onChange={e => setMemberDraft({ ...memberDraft, name: e.target.value })} /></label>
              <label>Role
                <select value={memberDraft.role || 'child'} onChange={e => setMemberDraft({ ...memberDraft, role: e.target.value as MemberRole })}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label>Colour<input value={memberDraft.colour || ''} onChange={e => setMemberDraft({ ...memberDraft, colour: e.target.value })} placeholder="#2F80ED" /></label>
              <label>Email (optional)<input value={memberDraft.email || ''} onChange={e => setMemberDraft({ ...memberDraft, email: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveMember} className="btn">{editingMemberId ? 'Save' : 'Add'}</button>
              {editingMemberId && <button onClick={cancelEditMember} className="btn btn-secondary">Cancel</button>}
            </div>
          </div>
        </div>
      </div>

      {/* Tags + Checklist */}
      <div className="card">
        <h3>Tags &amp; Checklist</h3>
        <div className="grid2">
          <div>
            <h4>Common tags</h4>
            <div className="row-wrap">
              {(s.tags || []).map(t => <span className="pill" key={t} onClick={() => removeTag(t)}>{t} ×</span>)}
            </div>
            <div className="row">
              <input placeholder="Add tag" value={tagInput} onChange={e => setTagInput(e.target.value)} />
              <button onClick={() => { const t = tagInput.trim(); if (t) s.setTags([...(s.tags || []), t]); setTagInput('') }} className="btn">Add</button>
            </div>
          </div>
          <div>
            <h4>What to bring</h4>
            <div className="row-wrap">
              {(s.checklist || []).map(t => <span className="pill" key={t} onClick={() => removeBring(t)}>{t} ×</span>)}
            </div>
            <div className="row">
              <input placeholder="Add item" value={bringInput} onChange={e => setBringInput(e.target.value)} />
              <button onClick={() => { const t = bringInput.trim(); if (t) s.setChecklist([...(s.checklist || []), t]); setBringInput('') }} className="btn">Add</button>
            </div>
          </div>
        </div>
      </div>

      {/* Integrations */}
      {featureFlags.get().google || featureFlags.get().integrations ? (
        <div className="card">
          <h3>Integrations</h3>
          {featureFlags.get().google && <GoogleConnectCard />}
          {/* Keep existing ICS shadows intact */}
          {featureFlags.get().integrations && (
            <div style={{ marginTop: 12 }}>
              <IntegrationsPanel />
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
