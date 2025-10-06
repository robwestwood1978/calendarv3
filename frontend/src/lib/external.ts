// frontend/src/lib/external.ts
import { listCalendars } from '../state/integrations'
import type { EventRecord } from '../lib/recurrence'

export function isExternal(evt: any): boolean {
  return !!(evt && (evt._calendarId || String(evt.id || '').startsWith('ext:')))
}

export function calendarMetaFor(evt: any): { id?: string, name?: string, color?: string, isExternal: boolean } {
  const ext = isExternal(evt)
  if (!ext) return { isExternal: false }
  const calId = (evt as any)._calendarId || parseFromId(String(evt.id || '')).calId
  if (!calId) return { isExternal: true }
  const cal = listCalendars().find(c => c.id === calId)
  return { id: cal?.id, name: cal?.name, color: cal?.color, isExternal: true }
}

/** ext:<calId>:<uid>[:<anything>] pattern fallback */
function parseFromId(id: string): { calId?: string, uid?: string } {
  if (!id.startsWith('ext:')) return {}
  const parts = id.split(':') // ext, calId, uid, ...
  return { calId: parts[1], uid: parts[2] }
}

/** Return a stable { calId, uid } identity for any external event. */
export function getExtIdentity(evt: any): { calId?: string, uid?: string } {
  const calId = evt?._calendarId || parseFromId(String(evt?.id || '')).calId
  const uid   = evt?._uid        || parseFromId(String(evt?.id || '')).uid
  return { calId, uid }
}

/** Compute the “ext key” we use to match provider items and shadows. */
export function toExtKey(evt: any): string | null {
  if (!isExternal(evt)) return null
  const { calId, uid } = getExtIdentity(evt)
  const start = evt?.start
  if (!calId || !uid || !start) return null
  return `${calId}::${uid}::${start}`
}
