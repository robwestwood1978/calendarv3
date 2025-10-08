# Slice D – Sync Core

This folder holds the provider-agnostic sync engine and provider adapters.

## Status
- **Core**: implemented (windowed pull + journal push; local-only persistence)
- **Google adapter**: skeleton (no network calls)
- **Apple adapter**: not added yet (will be CalDAV-based)
- **Feature flag**: sync is disabled by default (`readSyncConfig().enabled === false`)

## How to enable (dev)
1. Write a tiny bootstrap (e.g. in `App.tsx`) that:
   - reads config via `readSyncConfig()`
   - creates adapters (e.g. `createGoogleAdapter({...})`)
   - provides a `LocalStore` impl to `runSyncOnce({ adapters, store })`
2. Call `runSyncOnce` on app start and maybe on an interval.

## LocalStore adapter hint
Map these methods to your existing state:
- `listRange(startISO, endISO)` -> return current expanded items within range.
- `upsertMany(rows)` -> upsert into your local store (preserving existing fields).
- `applyDeletes(localIds)` -> mark/delete local rows.
- `rebind(localId, boundRef)` -> attach a RemoteRef under event._remote[].

## Conflict policy
- Pull: trust server etag if available, otherwise `updatedAt` comparison.
- Push: journal is idempotent; provider returns new etag and/or externalId.
