// frontend/src/components/Toaster.tsx
import React from 'react'

export default function Toaster() {
  const [msg, setMsg] = React.useState<string | null>(null)

  React.useEffect(() => {
    const onToast = (e: Event) => {
      const ce = e as CustomEvent<string>
      setMsg(ce.detail)
      const t = setTimeout(() => setMsg(null), 1600)
      return () => clearTimeout(t)
    }
    window.addEventListener('toast', onToast as any)
    return () => window.removeEventListener('toast', onToast as any)
  }, [])

  if (!msg) return null
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#111827',
        color: '#fff',
        borderRadius: 10,
        padding: '8px 12px',
        fontSize: 14,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        zIndex: 2147483000,
        pointerEvents: 'none',
      }}
    >
      {msg}
    </div>
  )
}
