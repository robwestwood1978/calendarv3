// frontend/src/sync/storage.ts
// Small persistence helpers for sync-local state.

const LS = {
  SYNC_CFG: 'fc_sync_config_v1',
  SYNC_TOKENS: 'fc_sync_tokens_v1',   // per provider token
  SYNC_JOURNAL: 'fc_sync_journal_v1', // append-only log
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

export function writeJSON<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function getKeys() { return LS }
