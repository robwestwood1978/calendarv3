// frontend/src/sync/journal.ts
// Append-only, idempotent local mutation journal.

import { getKeys, readJSON, writeJSON } from './storage'
import { JournalEntry, JournalAction, LocalEvent } from './types'
import { nextSeq, nowISO } from './clock'

type JournalState = {
  nextSeq: number
  entries: JournalEntry[]
}

const LS = getKeys()

export function readJournal(): JournalEntry[] {
  const st = readJSON<JournalState>(LS.SYNC_JOURNAL, { nextSeq: 1, entries: [] })
  return st.entries
}

function writeJournal(entries: JournalEntry[]) {
  const st = readJSON<JournalState>(LS.SYNC_JOURNAL, { nextSeq: 1, entries: [] })
  writeJSON(LS.SYNC_JOURNAL, { nextSeq: Math.max(st.nextSeq, entries.length + 1), entries })
}

export function recordMutation(action: JournalAction, before: Partial<LocalEvent> | undefined, after: Partial<LocalEvent> | undefined, eventId: string): JournalEntry {
  const seq = nextSeq()
  const entry: JournalEntry = {
    journalId: `${eventId}:${seq}`,
    clientSeq: seq,
    at: nowISO(),
    action,
    eventId,
    before, after,
  }
  const list = readJournal()
  // idempotency: drop if same journalId already present
  if (!list.find(e => e.journalId === entry.journalId)) {
    list.push(entry)
    writeJournal(list)
  }
  return entry
}

export function popBatch(max = 50): JournalEntry[] {
  const list = readJournal()
  return list.slice(0, max)
}

export function dropEntries(ids: string[]) {
  const list = readJournal().filter(e => !ids.includes(e.journalId))
  writeJournal(list)
}

export function purgeJournal() {
  writeJSON(LS.SYNC_JOURNAL, { nextSeq: 1, entries: [] })
}
