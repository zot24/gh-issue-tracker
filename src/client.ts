/**
 * Error tracker client — the main orchestrator.
 *
 * Singleton pattern: call `init()` once at startup, then use
 * `captureException()` / `captureMessage()` anywhere in your app.
 * All GitHub API calls are fire-and-forget. Call `flush()` in
 * serverless environments to wait for pending operations before returning.
 */

import type {
  ErrorTrackerConfig,
  ErrorContext,
  GitHubClient,
  BugReportInput,
  BugReportResult,
} from './types'
import { generateFingerprint } from './fingerprint'
import { RateLimiter } from './rate-limiter'
import { createGitHubClient } from './github'
import {
  DEFAULT_SCREENSHOT_BRANCH,
  DEFAULT_SCREENSHOT_PROXY_PATH,
  buildScreenshotPath,
  formatBugReportBody,
  pagePath,
  truncate,
  uint8ToBase64,
} from './bug-report'

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

  // Fingerprinting is async (Web Crypto), so it runs inside the fire-and-forget
  // promise; flush() still awaits the whole chain.
  const lim = limiter
  const promise = (async () => {
    const fingerprint = await generateFingerprint(error)

    if (!lim.canProcess(fingerprint)) {
      console.error(`[error-tracker] Rate limited or deduped: ${fingerprint}`)
      return
    }
    lim.recordProcessed(fingerprint)

    await processError(error, fingerprint, context)
  })().catch((err) => {
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

  const gh = github
  const lim = limiter
  const promise = (async () => {
    const fingerprint = await generateFingerprint(message)

    if (!lim.canProcess(fingerprint)) return
    lim.recordProcessed(fingerprint)

    const title = `[${level === 'warning' ? 'Warning' : 'Error'}] ${message.slice(0, 80)}`
    const body = formatBody(message, undefined, fingerprint, context)
    const labels = buildLabels(fingerprint)

    const existing = await gh.searchExistingIssue(fingerprint)

    if (existing?.state === 'open') {
      await gh.addReaction(existing.number)
    } else if (existing?.state === 'closed') {
      if (config?.reopenClosed) {
        await gh.reopenIssue(existing.number, recurrenceComment())
        await gh.addReaction(existing.number)
      }
    } else {
      await gh.createIssue(title, body, labels)
    }
  })().catch((err) => {
    config?.onError?.(err)
  })

  pending.push(promise)
}

/**
 * Capture a user-submitted bug report as a GitHub issue, optionally with a
 * screenshot. Unlike `captureException`, this is NOT fire-and-forget or deduped
 * — it awaits the GitHub calls and returns the created issue so the caller (an
 * API route) can surface the result. Requires `init()` to have been called.
 *
 * If `input.screenshot` is set, the image is committed to the configured
 * screenshot branch and embedded in the issue. For private repos, set
 * `appBaseUrl` in `init()` and serve `fetchIssueImage()` at the proxy path so
 * the image renders.
 */
export async function captureBugReport(
  input: BugReportInput,
): Promise<BugReportResult | null> {
  if (!config?.enabled || !github) return null
  const gh = github
  const cfg = config

  let screenshotUrl: string | undefined
  if (input.screenshot) {
    const branch = cfg.screenshotBranch ?? DEFAULT_SCREENSHOT_BRANCH
    const path = buildScreenshotPath(input.reporter.id, input.screenshot.filename)
    const uploaded = await gh.uploadImage({
      branch,
      path,
      base64Content: uint8ToBase64(input.screenshot.data),
      message: `chore(bug-report): add screenshot ${path}`,
    })
    if (uploaded) {
      if (cfg.appBaseUrl) {
        const base = cfg.appBaseUrl.replace(/\/$/, '')
        const proxy = (cfg.screenshotProxyPath ?? DEFAULT_SCREENSHOT_PROXY_PATH).replace(
          /^\/|\/$/g,
          '',
        )
        screenshotUrl = `${base}/${proxy}/${path}`
      } else {
        // Public-repo fallback — raw.githubusercontent works without a token.
        screenshotUrl = `https://raw.githubusercontent.com/${cfg.githubRepo}/${branch}/${path}`
      }
    }
  }

  const title = `[Bug Report] ${truncate(input.message.replace(/\s+/g, ' ').trim(), 80)} — ${pagePath(input.pageUrl)}`
  const body = formatBugReportBody(input, screenshotUrl, cfg.environment)
  const labels = ['bug-report', ...(input.labels ?? [])]

  const issue = await gh.createIssue(title, body, labels)
  if (!issue) return null

  return { issueNumber: issue.number, issueUrl: issue.url, screenshotUrl }
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
