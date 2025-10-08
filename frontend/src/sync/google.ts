// frontend/src/sync/google.ts
// Google adapter skeleton. Wire your OAuth + fetch calls in here.

import { ProviderAdapter, RemoteDelta, PushIntent, PushResult } from './types'

export function createGoogleAdapter(opts: {
  accountKey?: string
  calendars?: string[]
}): ProviderAdapter {
  return {
    provider: 'google',

    async pull({ sinceToken, rangeStartISO, rangeEndISO }) {
      // TODO: call Google Calendar API with syncToken (sinceToken), timeMin/timeMax
      // For D1 skeleton, return empty change set.
      const events: RemoteDelta[] = []
      const token = sinceToken ?? null
      return { token, events }
    },

    async push(intents: PushIntent[]) {
      // TODO: map LocalEvent -> Google insert/update/delete with etags
      const results: PushResult[] = intents.map((i) => ({
        ok: true,
        action: i.action,
        localId: i.local.id,
        bound: i.target ?? undefined,
      }))
      return results
    },
  }
}
