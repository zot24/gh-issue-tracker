'use client'

import { useEffect } from 'react'

/**
 * Root error boundary component for Next.js App Router.
 *
 * Place this file at: app/error.tsx
 *
 * Catches errors in the route segment and displays a fallback UI.
 * Reports errors to the server-side error tracker via the proxy endpoint.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Report to server-side error tracker via proxy (fire-and-forget)
    fetch('/api/errors/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: window.location.href,
        boundary: 'root',
      }),
    }).catch(() => {})
  }, [error])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '400px', width: '100%' }}>
        <h1
          style={{
            fontSize: '1.5rem',
            marginBottom: '1rem',
            color: '#dc2626',
          }}
        >
          Something went wrong
        </h1>

        <p
          style={{
            color: '#666',
            marginBottom: '1.5rem',
            lineHeight: 1.6,
          }}
        >
          We encountered an unexpected error. Please try again, or contact
          support if the problem persists.
        </p>

        {error.digest && (
          <p
            style={{
              fontSize: '0.75rem',
              color: '#999',
              marginBottom: '1.5rem',
              fontFamily: 'monospace',
            }}
          >
            Error ID: {error.digest}
          </p>
        )}

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Try again
          </button>

          <a
            href="/"
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#fff',
              color: '#333',
              border: '1px solid #e5e5e5',
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  )
}
