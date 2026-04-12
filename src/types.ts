/**
 * Configuration for the error tracker.
 * Pass to `init()` at app startup.
 */
export interface ErrorTrackerConfig {
  /** GitHub Personal Access Token with `repo` scope */
  githubToken: string
  /** Repository in "owner/repo" format */
  githubRepo: string
  /** Environment name included in issue body. Default: "development" */
  environment?: string
  /** Additional labels applied to created issues (beyond "error-report"). */
  labels?: string[]
  /** Kill switch. Default: true */
  enabled?: boolean
  /** Called when GitHub API fails. Default: console.error */
  onError?: (err: unknown) => void
  /** Max new issues created per minute. Default: 10 */
  rateLimitPerMinute?: number
  /** Suppress duplicate fingerprints within this window (ms). Default: 60_000 */
  dedupeWindowMs?: number
  /** Reopen closed issues on recurrence instead of ignoring. Default: true */
  reopenClosed?: boolean
}

/**
 * Additional context attached to a captured error.
 */
export interface ErrorContext {
  tags?: Record<string, string>
  extras?: Record<string, unknown>
  user?: { id: string; email?: string }
  requestUrl?: string
  serverName?: string
}

/**
 * Internal representation of a processed error event.
 */
export interface ErrorEvent {
  fingerprint: string
  title: string
  body: string
  labels: string[]
  timestamp: string
}

/**
 * Result of searching for an existing GitHub issue.
 */
export interface ExistingIssue {
  number: number
  state: 'open' | 'closed'
  title: string
}

/**
 * Interface for the GitHub API layer, enabling test mocking.
 */
export interface GitHubClient {
  searchExistingIssue(fingerprint: string): Promise<ExistingIssue | null>
  createIssue(title: string, body: string, labels: string[]): Promise<number | null>
  addReaction(issueNumber: number): Promise<void>
  reopenIssue(issueNumber: number, comment: string): Promise<void>
}
