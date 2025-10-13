// frontend/src/sync/push-bridge.ts
// Minimal write bridge: listen for app saves/deletes and push to Google.

import { createGoogleAdapter } from './google'
import type { PushIntent } from './types'
import type { EventRecord } from '../lib/recurrence'
import { readSyncConfig } from './core'

// Build a single Google adapter from current config (defaults to "primary")
function getGoogle() {
  const cfg = readSyncConfig()
  const g = cfg?.providers?.google
  if (!cfg?.enabled || !g?.enabled) return null
  const calendars =
    (Array.isArray(g.calendars) && g.calendars.length > 0) ? g.calendars : ['primary']
  return createGoogleAdapter({ calendars })
}

// Convert a local event into a PushIntent (create/update) using its _remote binding (if any)
function upsertIntent(local: EventRecord): PushIntent {
  const binding = Array.isArray((local as any)._remote)
    ? (local as any)._remote.find((r: any) => r?.provider === 'google')
    : undefined

  if (binding?.externalId) {
    return { action: 'update', local, target: binding }
  }
  // no binding → create into preferred calendar (first configured one)
  return {
    action: 'create',
    local,
    preferredTarget: { provider: 'google', calendarId: undefined } // adapter will default to 'primary'
  }
}

// Delete intent carries the last known binding
function deleteIntent(local: EventRecord): PushIntent {
  const binding = Array.isArray((local as any)._remote)
    ? (local as any)._remote.find((r: any) => r?.provider === 'google')
    : undefined
  return { action: 'delete', local, target: binding }
}

// Listen for app events
export function installGooglePushBridge() {
  const handler = async (ev: Event) => {
    const detail = (ev as CustomEvent).detail as
      | { type: 'upsert'; event: EventRecord }
      | { type: 'delete'; event: EventRecord }
    if (!detail) return

    const google = getGoogle()
    if (!google) return // sync disabled or google not enabled

    const intents: PushIntent[] = [
      detail.type === 'upsert' ? upsertIntent(detail.event) : deleteIntent(detail.event),
    ]

    try {
      const results = await google.push(intents)
      // Optional: show toast on first failure
      const firstError = results.find(r => !r.ok)?.error
      if (firstError) {
        window.dispatchEvent(new CustomEvent('toast', { detail: `Google save failed: ${firstError}` }))
      }
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('toast', { detail: `Google sync error: ${e?.message || e}` }))
    }
  }

  window.addEventListener('fc:request-push', handler as any)
}
