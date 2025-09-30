// src/components/ErrorBoundary.tsx
import React from 'react'

type State = { error: Error | null }

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: any) {
    // Optionally log somewhere
    console.error('UI crash:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24 }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 12, borderRadius: 8 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <p className="hint">If this persists, refresh or go to Settings and review your configuration.</p>
        </div>
      )
    }
    return this.props.children
  }
}
