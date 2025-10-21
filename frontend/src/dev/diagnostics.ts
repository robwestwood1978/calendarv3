// Side-effect module that safely wires the diagnostics hotkey and optional
// “Sync Inspector” floating button without breaking the app via IIFE/semicolon issues.

export {} // ensure this is a module

declare global {
  interface Window {
    FC_TRACE?: boolean;
  }
}

(function initDiagnostics() {
  // 1) Read ?trace=1 to enable diagnostics on boot
  try {
    const u = new URL(location.href);
    if (u.searchParams.get('trace') === '1') {
      window.FC_TRACE = true;
    }
  } catch {
    /* no-op */
  }

  // 2) Ctrl/Cmd + Alt + S toggles diagnostics and fires a toast
  try {
    window.addEventListener('keydown', (e) => {
      const combo = (e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 's';
      if (!combo) return;
      const next = !Boolean(window.FC_TRACE);
      window.FC_TRACE = next;
      try {
        window.dispatchEvent(
          new CustomEvent('toast', { detail: next ? 'Diagnostics ON' : 'Diagnostics OFF' })
        );
      } catch {
        /* no-op */
      }
    });
  } catch {
    /* no-op */
  }

  // 3) If diagnostics are ON, render a small button to open the inspector
  function mountInspectorButton() {
    try {
      if (!window.FC_TRACE) return;
      const existing = document.getElementById('fc-sync-inspector-btn');
      if (existing) return;

      const btn = document.createElement('button');
      btn.id = 'fc-sync-inspector-btn';
      btn.textContent = 'Sync Inspector';
      Object.assign(btn.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '9999',
        padding: '8px 10px',
        borderRadius: '10px',
        border: '1px solid #e5e7eb',
        background: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,.1)',
        cursor: 'pointer',
      } as CSSStyleDeclaration);
      btn.onclick = () => {
        try {
          window.dispatchEvent(new CustomEvent('fc:open-sync-inspector'));
        } catch {
          /* no-op */
        }
      };
      document.body.appendChild(btn);
    } catch {
      /* no-op */
    }
  }

  // Mount the button when DOM is ready *if* diagnostics are on
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountInspectorButton, { once: true });
    } else {
      mountInspectorButton();
    }
  } catch {
    /* no-op */
  }
})();
