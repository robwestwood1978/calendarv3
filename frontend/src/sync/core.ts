// frontend/src/sync/core.ts
// Unified sync engine: windowed pull, journal-driven push, conflict policy (safe) + diagnostics.

import { DateTime } from 'luxon'
import { getKeys, readJSON, writeJSON } from './storage'
import { ProviderAdapter, SyncConfig, LocalEvent, PushIntent, PushResult } from './types'
import { popBatch, dropEntries } from './journal'
import { diag } from './diag'

const LS = getKeys()

type TokenState = {
  [provider: string]: {
    sinceToken: string | null
    lastRunISO?: string
  }
}

function nowISO() { return new Date().toISOString() }

export function readSyncConfig(): SyncConfig {
  const raw = localStorage.getItem(LS.SYNC_CONFIG)
  try { return raw ? JSON.parse(raw) : { enabled: false, providers: {} } } catch { return { enabled: false, providers: {} } }
}

export function writeSyncConfig(cfg: SyncConfig) {
  try { localStorage.setItem(LS.SYNC_CONFIG, JSON.stringify(cfg)) } catch {}
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
  applyDeletes(localIds: string[]): void
}

export async function runSyncOnce(params: {
  adapters: ProviderAdapter[]
  store: LocalStore
  now?: Date
}) {
  const { adapters, store } = params
  const now = params.now ?? new Date()

  diag.log({ phase: 'note', kind: 'sync.start', msg: 'begin' })

  // --- PULL window ---
  const t0 = DateTime.fromJSDate(now)
  const rangeStartISO = t0.minus({ days: 30 }).toISO()!
  const rangeEndISO = t0.plus({ days: 365 }).toISO()!

  const tokens = readTokens()

  for (const ad of adapters) {
    try {
      const state = tokens[ad.provider] || { sinceToken: null }
      const res = await ad.pull({ sinceToken: state.sinceToken, rangeStartISO, rangeEndISO })

      const upserts: LocalEvent[] = []
      const deletes: string[] = []

      for (const d of res.events) {
        if (d.operation === 'delete') {
          deletes.push(d.externalId)
          diag.pull({
            provider: ad.provider as any,
            kind: 'pull.delete',
            externalId: d.externalId,
            calendarId: d.calendarId
          })
        } else if (d.operation === 'upsert' && d.payload) {
          upserts.push({ ...(d.payload as any) })
          diag.pull({
            provider: ad.provider as any,
            kind: 'pull.upsert',
            externalId: d.externalId,
            calendarId: d.calendarId
          })
        }
      }

      if (upserts.length) store.upsertMany(upserts)
      if (deletes.length) store.applyDeletes(deletes)

      tokens[ad.provider] = { sinceToken: res.token, lastRunISO: now.toISOString() }
      writeTokens(tokens)
    } catch (e: any) {
      console.warn(`[sync][pull] failed for ${ad.provider}`, e)
      diag.error({ provider: ad.provider as any, msg: `[pull] ${String(e?.message || e)}` })
    }
  }

  // --- JOURNAL → PUSH ---
  const batch = popBatch()
  if (!batch || batch.length === 0) {
    diag.log({ phase: 'note', kind: 'sync.end', msg: 'journal had no entries' })
    return { ok: true }
  }

  // Build one PushIntent per journal row with the current local snapshot
  const intents: PushIntent[] = []
  for (let i = 0; i < batch.length; i++) {
    const jr = batch[i]
    const localList = store.listRange(rangeStartISO, rangeEndISO)
    const local = localList.find(e => e.id === jr.eventId)

    if (jr.action === 'delete') {
      intents.push({ journalId: jr.journalId, action: 'delete', local })
      diag.journal({ action: 'delete', localId: jr.eventId })
    } else {
      if (!local) {
        // cannot update without the local snapshot → keep entry for next round
        diag.error({ msg: `[journal] missing local snapshot for ${jr.eventId}` })
        continue
      }
      intents.push({
        journalId: jr.journalId,
        action: jr.action,
        local,
        after: { id: local.id, title: local.title, start: local.start, end: local.end, allDay: local.allDay }
      })
    }
  }

  if (intents.length === 0) {
    diag.log({ phase: 'note', kind: 'sync.end', msg: 'journal had no valid rows' })
    return { ok: true }
  }

  for (const ad of params.adapters) {
    try {
      const rs = await ad.push(intents)

      // success accounting & drop matched rows
      const dropIds: string[] = []
      let iIntent = 0

      for (let i = 0; i < intents.length; i++) {
        const inx = intents[i]
        const jr = batch[iIntent] // positions align by construction

        const res = rs[i] as PushResult | undefined

        // log each individual result
        diag.pushResult({
          provider: ad.provider as any,
          action: inx.action,
          localId: inx.local?.id,
          externalId: (res as any)?.bound?.externalId,
          calendarId: (res as any)?.bound?.calendarId,
          etag: (res as any)?.bound?.etag,
          result: res
        })

        // *** CRITICAL FIX: only drop when we're definitively bound ***
        if (res?.ok && (res as any)?.bound?.externalId) dropIds.push(jr.journalId)

        iIntent++
      }

      if (dropIds.length) dropEntries(dropIds)
    } catch (e) {
      console.warn(`[sync][push] failed for ${ad.provider}`, e)
      diag.error({ provider: ad.provider as any, msg: `[push] ${String(e?.message || e)}` })
    }
  }

  diag.log({ phase: 'note', kind: 'sync.end', msg: 'done' })
  return { ok: true }
}
