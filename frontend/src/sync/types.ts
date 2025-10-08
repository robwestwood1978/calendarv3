// frontend/src/sync/types.ts
// Shared types for Slice D Sync Core (provider-agnostic)

import type { DateTime } from 'luxon'

// Providers we support (adapter per provider)
export type Provider = 'google' | 'apple'

// A stable identity for remote resources
export interface RemoteRef {
  provider: Provider
  calendarId: string        // remote calendar/container id
  externalId: string        // remote event id (or CalDAV href/UID key)
  etag?: string             // for concurrency where available
}

// Minimal local event shape the sync engine needs (compatible with EventRecord)
export interface LocalEvent {
  id: string
  title: string
  start: string   // ISO
  end: string     // ISO
  allDay?: boolean
  location?: string
  notes?: string
  attendees?: string[]
  tags?: string[]
  colour?: string
  rrule?: string
  deleted?: boolean

  // Slice D additions (non-breaking; optional until migrations wire them in)
  _remote?: RemoteRef[]     // zero or many remote bindings (multi-home)
  _updatedAt?: string       // ISO, monotonic clock from clock.ts
  _lastSyncedAt?: string    // ISO of last successful sync including this row
}

// Journal entry representing a local mutation (idempotent)
export type JournalAction = 'create' | 'update' | 'delete'

export interface JournalEntry {
  journalId: string        // unique idempotency key
  clientSeq: number        // monotonic local sequence
  at: string               // ISO timestamp (monotonic)
  action: JournalAction
  eventId: string          // local id
  before?: Partial<LocalEvent>
  after?: Partial<LocalEvent>
}

// Provider adapter interface
export interface ProviderAdapter {
  provider: Provider

  // Fetch remote deltas changed since a token; return new token.
  pull(params: {
    sinceToken?: string | null
    rangeStartISO: string
    rangeEndISO: string
  }): Promise<{
    token: string | null
    events: RemoteDelta[]
  }>

  // Push local journal entries to remote; return applied refs (externalId/etag)
  push(entries: PushIntent[]): Promise<PushResult[]>
}

// Remote change set item
export interface RemoteDelta {
  ref?: RemoteRef             // present if existing
  externalId?: string         // for convenience
  calendarId: string
  operation: 'upsert' | 'delete'
  payload?: Partial<LocalEvent>  // mapped to local fields (ISO strings, etc.)
  etag?: string
}

// Push intent (resolved by core from journal)
export interface PushIntent {
  action: JournalAction
  local: LocalEvent
  target?: RemoteRef          // if already bound to a remote resource
}

// Push result after provider call
export interface PushResult {
  ok: boolean
  action: JournalAction
  localId: string
  bound?: RemoteRef          // new binding (for creates) or updated etag
  error?: string
}

// Sync configuration (per household/app instance)
export interface SyncConfig {
  enabled: boolean
  providers: {
    google?: {
      enabled: boolean
      // OAuth/access details would be stored elsewhere; referenced by key here
      accountKey?: string
      calendars?: string[]     // which calendars to sync
    }
    apple?: {
      enabled: boolean
      accountKey?: string
      calendars?: string[]
    }
  }
  windowWeeks: number          // how far to sync from "now"
}
