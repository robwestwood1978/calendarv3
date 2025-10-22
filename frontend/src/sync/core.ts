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
  applyDeletes(localIds: string[]): void
  rebind(localId: string, boundRef: { provider: string; calendarId: string; externalId: string; etag?: string }): void
}

function isISO(x: any): x is string {
  if (typeof x !== 'string') return false
  const d = new Date(x)
  return !isNaN(+d)
}

function validLocal(ev: any): ev is LocalEvent {
  return ev && typeof ev === 'object' && typeof ev.id === 'string' && isISO(ev.start) && isISO(ev.end)
}

export async function runSyncOnce(params: {
  adapters: ProviderAdapter[]
  store: LocalStore
  now?: Date
}): Promise<{ ok: boolean; detail?: string }> {
  const cfg = readSyncConfig()
  if (!cfg.enabled) return { ok: true, detail: 'sync disabled' }

  const now = (params.now ? DateTime.fromJSDate(params.now) : DateTime.local())
  const start = now.startOf('day').toISO()!
  const end = now.plus({ weeks: cfg.windowWeeks }).endOf('day').toISO()!

  const tokens = readTokens()
  diag.log({ phase: 'note', kind: 'sync.start', msg: `window ${start} → ${end}` })

  // 1) PULL — provider deltas -> local
  for (const ad of params.adapters) {
    const t = tokens[ad.provider]?.sinceToken ?? null
    try {
      const res = await ad.pull({ sinceToken: t, rangeStartISO: start, rangeEndISO: end })

      const upserts: LocalEvent[] = []

      for (const d of res.events) {
        if (d.operation === 'delete') {
          diag.pullDelete({
            provider: ad.provider as any,
            calendarId: d.calendarId,
            externalId: d.externalId,
            etag: d.etag,
          })
          // left to your store to map remote → local and delete
          continue
        } else if (d.payload) {
          const p = d.payload as any
          diag.pullUpsert({
            provider: ad.provider as any,
            calendarId: d.calendarId,
            externalId: d.externalId,
            etag: d.etag,
            localId: p.id,
            after: { id: p.id, title: p.title, start: p.start, end: p.end, allDay: p.allDay }
          })
          upserts.push({ ...(d.payload as any) })
        }
      }

      if (upserts.length) {
        params.store.upsertMany(upserts)
        diag.reconcile({ msg: `upserts:${upserts.length}` })
      }

      tokens[ad.provider] = { sinceToken: res.token ?? null, lastRunISO: now.toISO()! }
      writeTokens(tokens)
    } catch (e: any) {
      console.warn(`[sync][pull] failed for ${ad.provider}`, e)
      diag.error({ provider: ad.provider as any, msg: `[pull] ${String(e?.message || e)}` })
    }
  }

  // 2) PUSH — drain journal as push intents (use journal snapshots, not listRange)
  const batch = popBatch(50)
  if (batch.length === 0) {
    diag.log({ phase: 'note', kind: 'sync.end', msg: 'no journal' })
    return { ok: true }
  }

  const intents: PushIntent[] = []
  for (const j of batch) {
    let local: any
    if (j.action === 'delete') {
      local = j.before || null
    } else {
      local = j.after || null
    }
    if (!validLocal(local)) {
      console.warn('[sync][push] skip journal row with invalid local snapshot:', j)
      diag.error({ kind: 'journal.invalid', msg: 'invalid local snapshot', before: j.before, after: j.after })
      continue
    }
    intents.push({ action: j.action, local })
    diag.journal({
      action: j.action,
      localId: local.id,
      after: { id: local.id, title: local.title, start: local.start, end: local.end, allDay: local.allDay }
    })
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
      for (let bi = 0; bi < batch.length && iIntent < intents.length; bi++) {
        const jr = batch[bi]
        const inx = intents[iIntent]
        const res = rs[iIntent]
        if (jr.eventId === inx.local.id && jr.action === inx.action) {
          // log each individual result
          diag.pushResult({
            provider: ad.provider as any,
            action: inx.action,
            localId: inx.local.id,
            externalId: (res as any)?.bound?.externalId,
            calendarId: (res as any)?.bound?.calendarId,
            etag: (res as any)?.bound?.etag,
            result: res
          })
          if (res?.ok) dropIds.push(jr.journalId)
          iIntent++
        }
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
