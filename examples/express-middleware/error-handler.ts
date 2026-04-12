/**
 * Express error handler middleware
 *
 * Captures unhandled errors and reports them to GitHub Issues.
 *
 * Usage:
 *   import { initErrorTracker, errorHandler } from './error-handler'
 *
 *   // At app startup
 *   initErrorTracker()
 *
 *   // After all routes
 *   app.use(errorHandler)
 */

import { init, captureException, flush } from 'gh-issue-tracker'
import type { ErrorRequestHandler } from 'express'

/**
 * Initialize the error tracker. Call once at app startup.
 */
export function initErrorTracker() {
  init({
    githubToken: process.env['GITHUB_TOKEN'] ?? '',
    githubRepo: process.env['GITHUB_REPO'] ?? '',
    environment: process.env['NODE_ENV'] ?? 'development',
    enabled: !!process.env['GITHUB_TOKEN'],
    labels: ['express-app'],
  })
}

/**
 * Express error handler middleware.
 * Place this after all other middleware and routes.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  captureException(err instanceof Error ? err : new Error(String(err)), {
    requestUrl: req.originalUrl,
    tags: {
      method: req.method,
      source: 'express-error-handler',
    },
  })

  // In a long-running Express server, flush() is not strictly required —
  // the GitHub API call will complete in the background. However, calling
  // flush() ensures the error is reported before the response is sent,
  // which is useful for debugging and for graceful shutdown scenarios.
  flush().finally(() => {
    res.status(500).json({ error: 'Internal server error' })
  })
}
