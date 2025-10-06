// frontend/src/lib/external.ts
// Helpers for identifying external (provider) events and local shadows/tombstones.

import type { EventRecord } from '../lib/recurrence'
import { listCalendars } from '../state/integrations'

/** True if the event originates from an external provider feed (Apple/Google/ICS). */
export function isExternal(evt: any): boolean {
  return !!(evt && (evt._calendarId || String(evt.id || '').startsWith('ext:')))
}

/** True if the event is a local “shadow” (our edited copy of an external item). */
export function isShadow(evt: any): boolean {
  return !!(evt && evt.source === 'shadow' && evt.extKey)
}

/** Badge/meta for UI */
export function calendarMetaFor(evt: any): { id?: string, name?: string, color?: string, isExternal: boolean } {
  const ext = isExternal(evt)
  if (!ext) return { isExternal: false }
  const { calId } = getExtIdentity(evt)
  if (!calId) return { isExternal: true }
  const cal = listCalendars().find(c => c.id === calId)
  return { id: cal?.id, name: cal?.name, color: cal?.color, isExternal: true }
}

/** Fallback parser for ids like: ext:<calId>:<uid>:<...> */
function parseFromId(id: string): { calId?: string, uid?: string } {
  if (!id || !id.startsWith('ext:')) return {}
  const parts = id.split(':') // ext, calId, uid, ...
  return { calId: parts[1], uid: parts[2] }
}

/** Return a stable identity even if _uid/_calendarId are missing (derive from id). */
export function getExtIdentity(evt: any): { calId?: string, uid?: string } {
  const calId = evt?._calendarId || parseFromId(String(evt?.id || '')).calId
  const uid   = evt?._uid        || parseFromId(String(evt?.id || '')).uid
  return { calId, uid }
}

/** Our matching key for external occurrences: calId::uid::start */
export function toExtKey(evt: any): string | null {
  if (!isExternal(evt)) return null
  const { calId, uid } = getExtIdentity(evt)
  const start = evt?.start
  if (!calId || !uid || !start) return null
  return `${calId}::${uid}::${start}`
}

/** Type guard just in case some callers want strict typing. */
export function asEvent(e: any): EventRecord | null {
  if (!e || typeof e !== 'object') return null
  if (!e.start || !e.end) return null
  return e as EventRecord
}
