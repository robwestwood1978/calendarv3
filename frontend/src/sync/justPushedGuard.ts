// frontend/src/sync/justPushedGuard.ts
// A tiny, framework-agnostic guard to ignore "remote echoes"
// right after we push a change to Google (client-wins debounce).

export type LiteEvent = {
  id?: string;                  // Google event id (externalId)
  summary?: string;
  location?: string | null;
  start?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null;
  status?: string | null;
  iCalUID?: string | null;
  sequence?: number | null;
  updated?: string | null;
};

type Stamp = {
  at: number;   // ms since epoch
  sig: string;  // stable signature of the event we just pushed
};

const WINDOW_MS = 10000; // ignore remote echoes for 10s by default

function stable(val: unknown): string {
  return JSON.stringify(val, Object.keys(val as object).sort());
}

function eventSignature(evt: LiteEvent): string {
  // Build a conservative signature from fields that tend to define identity/time
  return stable({
    summary: evt.summary ?? null,
    location: evt.location ?? null,
    start: evt.start?.dateTime ?? evt.start?.date ?? null,
    end: evt.end?.dateTime ?? evt.end?.date ?? null,
    status: evt.status ?? null,
    iCalUID: evt.iCalUID ?? null,
    sequence: evt.sequence ?? null,
  });
}

export class JustPushedGuard {
  private stamps: Map<string, Stamp> = new Map();

  /** Call this right after a successful push (create/update/move/delete). */
  notePush(externalId: string, evt: LiteEvent) {
    if (!externalId) return;
    const now = Date.now();
    this.prune(now);
    this.stamps.set(externalId, { at: now, sig: eventSignature(evt) });
  }

  /** Return true if a remote pull for the same id should be ignored as an echo. */
  shouldIgnorePull(externalId: string, evt: LiteEvent): boolean {
    if (!externalId) return false;
    const stamp = this.stamps.get(externalId);
    if (!stamp) return false;
    const now = Date.now();
    if (now - stamp.at > WINDOW_MS) {
      this.stamps.delete(externalId);
      return false;
    }
    const sig = eventSignature(evt);
    // If signatures match, it's almost certainly the server reflecting what we just pushed.
    if (sig === stamp.sig) {
      return true;
    }
    // Different signature: treat as real remote change and clear our stamp.
    this.stamps.delete(externalId);
    return false;
  }

  private prune(now: number) {
    for (const [k, v] of this.stamps.entries()) {
      if (now - v.at > WINDOW_MS) this.stamps.delete(k);
    }
  }
}

// Export a shared instance to make wiring very simple.
export const justPushedGuard = new JustPushedGuard();
