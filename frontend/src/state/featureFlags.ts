// frontend/src/state/featureFlags.ts
// Local feature flags, default OFF. Safe extension of Slice C.
// Storage key: fc_feature_flags_v1

export type FeatureFlags = {
  authEnabled: boolean
  integrations: boolean
  apple: boolean
  google: boolean
  classroom: boolean
  tasks: boolean
}

const LS = 'fc_feature_flags_v1'

const defaults: FeatureFlags = {
  authEnabled: false,
  integrations: false,
  apple: false,
  google: false,
  classroom: false,
  tasks: false,
}

function read(): FeatureFlags {
  try {
    const raw = localStorage.getItem(LS)
    if (!raw) return defaults
    const obj = JSON.parse(raw)
    return {
      authEnabled: !!obj.authEnabled,
      integrations: !!obj.integrations,
      apple: !!obj.apple,
      google: !!obj.google,
      classroom: !!obj.classroom,
      tasks: !!obj.tasks,
    }
  } catch {
    return defaults
  }
}

function write(patch: Partial<FeatureFlags>) {
  const merged = { ...read(), ...patch }
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
