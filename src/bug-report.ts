/**
 * Bug-report helpers — pure functions for turning a user bug report into a
 * GitHub issue (title, body, screenshot path/encoding). The orchestration that
 * actually uploads + creates the issue lives in `client.ts` (`captureBugReport`).
 */

import type { BugReportInput } from './types'

export const DEFAULT_SCREENSHOT_BRANCH = 'bug-report-screenshots'
export const DEFAULT_SCREENSHOT_PROXY_PATH = 'api/bug-screenshots'

/** Base64-encode bytes without Node's Buffer (edge/Workers safe). */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Deterministic, traversal-safe screenshot path: `yyyy/mm/<reporter>-<ts>-<name>`. */
export function buildScreenshotPath(reporterId: string, filename: string, now = new Date()): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const safeReporter = reporterId.replace(/[^a-zA-Z0-9._-]/g, '_')
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}/${mm}/${safeReporter}-${now.getTime()}-${safeName}`
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

export function pagePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.split('?')[0] ?? url
  }
}

/** Build the issue body for a bug report. */
export function formatBugReportBody(
  input: BugReportInput,
  screenshotUrl: string | undefined,
  environment: string | undefined,
): string {
  const pin =
    input.pin
      ? `(${input.pin.x.toFixed(1)}%, ${input.pin.y.toFixed(1)}%)`
      : 'Not specified'

  const sections: string[] = [
    '## User Bug Report',
    '',
    '### Reporter',
    `- **Name:** ${input.reporter.name ?? 'Not specified'}`,
    `- **Email:** ${input.reporter.email ?? 'Not specified'}`,
    `- **Role:** ${input.reporter.role ?? 'Not specified'}`,
    `- **User ID:** ${input.reporter.id}`,
    '',
    '### Location',
    `- **Page:** ${input.pageUrl}`,
    `- **Pin:** ${pin}`,
  ]

  const meta = Object.entries(input.metadata ?? {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  )
  if (meta.length > 0) {
    sections.push('', '### Environment')
    for (const [k, v] of meta) sections.push(`- **${k}:** ${v}`)
  }

  sections.push(
    '',
    `_Environment: ${environment ?? 'unknown'} • ${new Date().toISOString()}_`,
    '',
    '---',
    '',
    '### Description',
    input.message,
    '',
    '---',
    '',
    screenshotUrl
      ? `![Screenshot](${screenshotUrl})`
      : input.screenshot
        ? '_Screenshot upload failed_'
        : '_No screenshot attached_',
  )

  return sections.join('\n')
}
