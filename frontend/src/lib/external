// Helpers for external calendar events and local shadow overlays.

import type { EventRecord } from '../lib/recurrence'
import { listCalendars } from '../state/integrations'

export function isExternal(evt: any): boolean {
  return !!(evt && (evt._calendarId || String(evt.id || '').startsWith('ext:')))
}

export function calendarMetaFor(evt: any): { id?: string, name?: string, color?: string, isExternal: boolean } {
  const ext = isExternal(evt)
  if (!ext) return { isExternal: false }
  const calId = (evt as any)._calendarId
  if (!calId) return { isExternal: true }
  const cal = listCalendars().find(c => c.id === calId)
  return { id: cal?.id, name: cal?.name, color: cal?.color, isExternal: true }
}

// A unique key for a specific external occurrence (calendar + uid + start)
export function toExtKey(evt: any): string | null {
  if (!isExternal(evt)) return null
  const calId = (evt as any)._calendarId
  const uid = (evt as any)._uid || (String(evt.id || '').split(':')[2] ?? '')
  const start = (evt as any).start
  if (!calId || !uid || !start) return null
  return `${calId}::${uid}::${start}`
}
