// frontend/src/sync/clock.ts
// Monotonic-ish timestamp + sequence helpers for conflict policy.

let _seq = 0

export function nextSeq(): number {
  _seq += 1
  return _seq
}

export function nowISO(): string {
  // bias with seq to reduce same-ms collisions
  const base = new Date().toISOString()
  return base.replace('Z', `.${String(_seq).padStart(4, '0')}Z`)
}
