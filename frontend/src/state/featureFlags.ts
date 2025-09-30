// frontend/src/state/featureFlags.ts
// Local feature flags, default OFF. No external deps.
// Storage key: fc_feature_flags_v1

export type FeatureFlags = {
  authEnabled: boolean
}

const LS = 'fc_feature_flags_v1'
const defaultFlags: FeatureFlags = { authEnabled: false }

function read(): FeatureFlags {
  try {
    const raw = localStorage.getItem(LS)
    if (!raw) return defaultFlags
    const obj = JSON.parse(raw)
    return {
      authEnabled: !!obj.authEnabled,
    }
  } catch {
    return defaultFlags
  }
}

function write(next: Partial<FeatureFlags>) {
  const merged = { ...read(), ...next }
  localStorage.setItem(LS, JSON.stringify(merged))
  try { window.dispatchEvent(new CustomEvent('fc:flags:changed')) } catch {}
}

export const featureFlags = {
  get(): FeatureFlags { return read() },
  set(patch: Partial<FeatureFlags>) { write(patch) },
  subscribe(fn: () => void) {
    const onCustom = () => fn()
    const onStorage = (e: StorageEvent) => { if (e.key === LS) fn() }
    window.addEventListener('fc:flags:changed', onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('fc:flags:changed', onCustom)
      window.removeEventListener('storage', onStorage)
    }
  },
}
