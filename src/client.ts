/**
 * Error tracker client — the main orchestrator.
 *
 * Singleton pattern: call `init()` once at startup, then use
 * `captureException()` / `captureMessage()` anywhere in your app.
 * All GitHub API calls are fire-and-forget. Call `flush()` in
 * serverless environments to wait for pending operations before returning.
 */

import type { ErrorTrackerConfig, ErrorContext, GitHubClient } from './types'
import { generateFingerprint } from './fingerprint'
import { RateLimiter } from './rate-limiter'
import { createGitHubClient } from './github'

// ---------------------------------------------------------------------------
// Module state (singleton)
// ---------------------------------------------------------------------------

let config: ErrorTrackerConfig | null = null
let github: GitHubClient | null = null
let limiter: RateLimiter | null = null
const pending: Promise<void>[] = []

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the error tracker. Call once at app startup.
 */
export function init(cfg: ErrorTrackerConfig): void {
  config = {
    environment: 'development',
    enabled: true,
    reopenClosed: true,
    rateLimitPerMinute: 10,
    dedupeWindowMs: 60_000,
    labels: [],
    onError: console.error,
    ...cfg,
  }

  if (!config.enabled) return

  github = createGitHubClient({
    token: config.githubToken,
    repo: config.githubRepo,
    onError: config.onError!,
  })

  limiter = new RateLimiter({
    maxPerMinute: config.rateLimitPerMinute!,
    dedupeWindowMs: config.dedupeWindowMs!,
  })
}

/**
 * Capture an exception. Fire-and-forget — use `flush()` if you
 * need to wait for the GitHub API call to complete.
 */
export function captureException(error: Error, context?: ErrorContext): void {
  if (!config?.enabled || !github || !limiter) return

  const fingerprint = generateFingerprint(error)

  if (!limiter.canProcess(fingerprint)) {
    console.error(`[error-tracker] Rate limited or deduped: ${fingerprint}`)
    return
  }

  limiter.recordProcessed(fingerprint)

  const promise = processError(error, fingerprint, context).catch((err) => {
    config?.onError?.(err)
  })

  pending.push(promise)
}

/**
 * Capture a plain message as an error event.
 */
export function captureMessage(
  message: string,
  level: 'error' | 'warning' = 'error',
  context?: ErrorContext,
): void {
  if (!config?.enabled || !github || !limiter) return

  const fingerprint = generateFingerprint(message)

  if (!limiter.canProcess(fingerprint)) return

  limiter.recordProcessed(fingerprint)

  const title = `[${level === 'warning' ? 'Warning' : 'Error'}] ${message.slice(0, 80)}`
  const body = formatBody(message, undefined, fingerprint, context)
  const labels = buildLabels(fingerprint)

  const promise = github.searchExistingIssue(fingerprint).then(async (existing) => {
    if (!github) return

    if (existing?.state === 'open') {
      await github.addReaction(existing.number)
    } else if (existing?.state === 'closed') {
      if (config?.reopenClosed) {
        await github.reopenIssue(existing.number, recurrenceComment())
        await github.addReaction(existing.number)
      }
    } else {
      await github.createIssue(title, body, labels)
    }
  }).catch((err) => {
    config?.onError?.(err)
  })

  pending.push(promise)
}

/**
 * Wait for all pending error reports to complete.
 * Call before serverless function returns.
 */
export async function flush(): Promise<void> {
  await Promise.allSettled(pending)
  pending.length = 0
}

/**
 * Reset internal state. For testing only.
 * @internal
 */
export function _reset(): void {
  limiter?.destroy()
  config = null
  github = null
  limiter = null
  pending.length = 0
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function processError(
  error: Error,
  fingerprint: string,
  context?: ErrorContext,
): Promise<void> {
  if (!github) return

  const existing = await github.searchExistingIssue(fingerprint)

  if (existing?.state === 'open') {
    await github.addReaction(existing.number)
    return
  }

  if (existing?.state === 'closed') {
    if (config?.reopenClosed) {
      await github.reopenIssue(existing.number, recurrenceComment())
      await github.addReaction(existing.number)
    }
    return
  }

  // No existing issue — create one
  const title = `[Error] ${(error.name || 'Error')}: ${error.message.slice(0, 80)}`
  const body = formatBody(error.message, error.stack, fingerprint, context)
  const labels = buildLabels(fingerprint)

  await github.createIssue(title, body, labels)
}

function buildLabels(fingerprint: string): string[] {
  return [
    'error-report',
    `fingerprint:${fingerprint}`,
    ...(config?.labels ?? []),
  ]
}

function formatBody(
  message: string,
  stack: string | undefined,
  fingerprint: string,
  context?: ErrorContext,
): string {
  const env = config?.environment ?? 'unknown'
  const timestamp = new Date().toISOString()

  const sections = [
    `## Error Report (Automated)`,
    `**Environment:** ${env} | **Fingerprint:** \`${fingerprint}\` | **Time:** ${timestamp}`,
    '',
    `### Message`,
    message,
  ]

  if (stack) {
    sections.push('', '### Stack Trace', '```', stack, '```')
  }

  if (context?.tags && Object.keys(context.tags).length > 0) {
    const tagLines = Object.entries(context.tags)
      .map(([k, v]) => `- **${k}:** ${v}`)
      .join('\n')
    sections.push('', '### Tags', tagLines)
  }

  if (context?.requestUrl) {
    sections.push('', `**Request URL:** ${context.requestUrl}`)
  }

  if (context?.user) {
    sections.push(`**User:** ${context.user.id}${context.user.email ? ` (${context.user.email})` : ''}`)
  }

  if (context?.extras && Object.keys(context.extras).length > 0) {
    sections.push(
      '',
      '<details>',
      '<summary>Additional metadata</summary>',
      '',
      '```json',
      JSON.stringify(context.extras, null, 2),
      '```',
      '</details>',
    )
  }

  return sections.join('\n')
}

function recurrenceComment(): string {
  const env = config?.environment ?? 'unknown'
  return `**Recurrence detected** at ${new Date().toISOString()} in \`${env}\` environment.`
}
