// frontend/src/sync/diag-boot.ts
import { installGlobalDiag, isDiagEnabled, setDiagEnabled } from './diag'

// Install globals
installGlobalDiag()

// Keyboard: Ctrl/Cmd + Alt + S toggles trace
window.addEventListener('keydown', (e) => {
  const mod = (e.ctrlKey || e.metaKey) && e.altKey && (e.key.toLowerCase() === 's')
  if (!mod) return
  const on = !isDiagEnabled()
  setDiagEnabled(on)
  try {
    window.dispatchEvent(new CustomEvent('toast', { detail: on ? 'Diagnostics ON' : 'Diagnostics OFF' }))
  } catch {}
})

// If ?trace=1 in URL, show a small corner button to open inspector (UI file below).
(function () {
  try {
    const q = new URL(location.href).searchParams
    if (q.get('trace') !== '1') return
    const btn = document.createElement('button')
    btn.textContent = 'Sync Inspector'
    Object.assign(btn.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: '9999',
      padding: '8px 10px', borderRadius: '10px', border: '1px solid #e5e7eb',
      background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.1)', cursor: 'pointer'
    })
    btn.onclick = () => window.dispatchEvent(new CustomEvent('fc:open-sync-inspector'))
    document.body.appendChild(btn)
  } catch {}
})()
