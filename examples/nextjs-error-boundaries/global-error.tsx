'use client'

import { useEffect } from 'react'

/**
 * Global error boundary for the entire application.
 *
 * Place this file at: app/global-error.tsx
 *
 * Catches errors in the root layout or during React rendering
 * that aren't caught by nested error boundaries.
 * Must define its own <html> and <body> tags.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    fetch('/api/errors/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: window.location.href,
        boundary: 'global',
      }),
    }).catch(() => {})
  }, [error])

  return (
    <html lang="en">
      <body>
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
              A critical error occurred. Please try refreshing the page, or
              contact support if the problem persists.
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
          </div>
        </div>
      </body>
    </html>
  )
}
