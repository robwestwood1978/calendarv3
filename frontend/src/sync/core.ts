// frontend/src/sync/core.ts
// Unified sync engine: windowed pull, journal-driven push, conflict policy.
// FIX: correct journal dropping (by localId), and prevent overlapping runs.

import { DateTime } from 'luxon'
import { getKeys, readJSON, writeJSON } from './storage'
import { ProviderAdapter, SyncConfig, LocalEvent, PushIntent, PushResult, JournalEntry } from './types'
import { popBatch, dropEntries } from './journal'

const LS = getKeys()

type TokenState = {
  [provider: string]: {
    sinceToken: string | null
    lastRunISO?: string
  }
}

export function readSyncConfig(): SyncConfig {
  return readJSON<SyncConfig>(LS.SYNC_CFG, {
    enabled: false,
    providers: { google: { enabled: false }, apple: { enabled: false } },
    windowWeeks: 8,
  })
}

export function writeSyncConfig(cfg: SyncConfig) {
  writeJSON(LS.SYNC_CFG, cfg)
}

export function readTokens(): TokenState {
  return readJSON<TokenState>(LS.SYNC_TOKENS, {})
}

export function writeTokens(t: TokenState) {
  writeJSON(LS.SYNC_TOKENS, t)
}

/** Wire this to your local event store read/write */
export type LocalStore = {
  listRange(startISO: string, endISO: string): LocalEvent[]
  upsertMany(rows: LocalEvent[]): void
  applyDeletes?(localIds: string[]): void
  rebind(localId: string, boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }): void
  getById?(id: string): LocalEvent | null
}

function log(...args: any[]) {
  try { console.log('[sync]', ...args) } catch {}
}

/** prevent overlapping runs */
let inFlight = false

export async function runSyncOnce(params: {
  adapters: ProviderAdapter[]
  store: LocalStore
  now?: Date
}): Promise<{ ok: boolean; detail?: string }> {
  if (inFlight) { log('skip (in-flight)'); return { ok: true, detail: 'in-flight' } }
  inFlight = true
  try {
    const cfg = readSyncConfig()
    if (!cfg.enabled) return { ok: true, detail: 'sync disabled' }

    const now = (params.now ? DateTime.fromJSDate(params.now) : DateTime.local())
    log('run…', now.toISO())

    // pull a little history for stability
    const start = now.minus({ weeks: 1 }).startOf('day').toISO()!
    const end = now.plus({ weeks: cfg.windowWeeks }).endOf('day').toISO()!

    const tokens = readTokens()

    // 1) PULL
    for (const ad of params.adapters) {
      const t = tokens[ad.provider]?.sinceToken ?? null
      try {
        const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })

        const upserts: LocalEvent[] = []
        for (const d of res.events) {
          if (d.operation === 'delete') {
            // optional: params.store.applyDeletes?.([d.externalId])
            continue
          }
          if (d.payload) upserts.push({ ...(d.payload as any) })
        }
        if (upserts.length) params.store.upsertMany(upserts)

        tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
        writeTokens(tokens)
      } catch (e: any) {
        console.warn(`pull failed for ${ad.provider}`, e)
        // continue with other providers
      }
    }

    // 2) PUSH
    const batch = popBatch(50)
    if (batch.length === 0) { log('done:', { ok: true }); return { ok: true } }

    // Build intents; try to resolve the actual event row
    const intents: PushIntent[] = batch.map((j: JournalEntry) => {
      const ev = (params.store.getById?.(j.eventId)) ||
        params.store.listRange(j.at, j.at)[0] ||
        ({ id: j.eventId, title: '', start: j.at, end: j.at } as any)
      return { action: j.action, local: ev }
    })

    log('push intents:', intents.length)

    // Create a lookup from localId -> all journalIds we plan to drop on success
    const byLocalId = new Map<string, string[]>()
    batch.forEach(j => {
      const list = byLocalId.get(j.eventId) || []
      list.push(j.journalId)
      byLocalId.set(j.eventId, list)
    })

    // Send to each adapter (Google will only act on its own targets)
    for (const ad of params.adapters) {
      try {
        const rs: PushResult[] = await ad.push(intents)

        // Drop journal entries by localId (not by array index!)
        const drop: string[] = []
        for (const r of rs) {
          if (r.ok && r.localId) {
            const ids = byLocalId.get(r.localId) || []
            drop.push(...ids)
            // apply binding (create/update) so future runs are idempotent
            if (r.bound) params.store.rebind(r.localId, r.bound)
          }
        }
        if (drop.length) dropEntries(drop)

        log('push success:', rs.filter(r => r.ok).length, 'of', rs.length)
      } catch (e) {
        console.warn(`push failed for ${ad.provider}`, e)
      }
    }

    log('done:', { ok: true })
    return { ok: true }
  } finally {
    inFlight = false
  }
}
