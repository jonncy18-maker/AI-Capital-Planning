'use client'

import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: '16px',
          background: 'var(--bg-app, #0f1117)', color: 'var(--tx-1, #e8eaf0)',
          fontFamily: 'Inter, sans-serif', padding: '32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '32px' }}>⚠</div>
          <div style={{ fontSize: '18px', fontWeight: 600 }}>Something went wrong</div>
          <div style={{ fontSize: '13px', color: 'var(--tx-3, #6b7280)', maxWidth: '480px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '8px', padding: '10px 24px', borderRadius: '8px',
              border: 'none', background: 'var(--accent, #6366f1)', color: '#fff',
              fontSize: '14px', fontWeight: 500, cursor: 'pointer',
            }}
          >
            Reload app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
