/**
 * Next.js Instrumentation — Server-side error tracking
 *
 * Place this file at the root of your Next.js app (next to package.json).
 * Next.js automatically calls register() once at startup and
 * onRequestError() for unhandled request errors.
 *
 * Environment variables:
 *   GITHUB_TOKEN  — GitHub PAT with Issues read/write permission
 *   GITHUB_REPO   — Target repository in "owner/repo" format
 *   APP_ENV       — Environment name (e.g., "production", "staging")
 */

import { init as initErrorTracker, captureException, flush } from 'gh-issue-tracker'

export async function register() {
  initErrorTracker({
    // Required: GitHub Personal Access Token with Issues permissions
    githubToken: process.env['GITHUB_TOKEN'] ?? '',

    // Required: Repository where issues will be created (e.g., "myorg/myapp")
    githubRepo: process.env['GITHUB_REPO'] ?? '',

    // Optional: Environment name shown in the issue body
    environment: process.env['APP_ENV'] ?? 'development',

    // Kill switch: disable when no token is configured
    enabled: !!process.env['GITHUB_TOKEN'],

    // Optional: Additional labels added to every issue (useful for multi-app repos)
    labels: ['my-app'],
  })
}

export async function onRequestError(error: unknown) {
  if (error instanceof Error) {
    captureException(error, { tags: { source: 'onRequestError' } })
  } else {
    captureException(new Error(String(error)), { tags: { source: 'onRequestError' } })
  }
  // Wait for the GitHub API call before the serverless function exits
  await flush()
}
