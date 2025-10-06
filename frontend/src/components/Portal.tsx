// frontend/src/components/Portal.tsx
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function Portal({ children }: { children: React.ReactNode }) {
  const elRef = useRef<HTMLDivElement | null>(null)
  if (!elRef.current) elRef.current = document.createElement('div')

  useEffect(() => {
    const el = elRef.current!
    document.body.appendChild(el)
    return () => { try { document.body.removeChild(el) } catch {} }
  }, [])

  return createPortal(children, elRef.current)
}
