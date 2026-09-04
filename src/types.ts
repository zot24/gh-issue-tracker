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
  /**
   * How bug-report screenshots are stored.
   * `"user-attachment"` (default): GitHub user-attachments CDN (`gh --attach`).
   * `"branch"`: Contents API + optional proxy. GHES / existing setups only.
   */
  screenshotUpload?: 'user-attachment' | 'branch'
  /**
   * Branch where bug-report screenshots are committed when
   * `screenshotUpload` is `"branch"`. Default: "bug-report-screenshots"
   */
  screenshotBranch?: string
  /**
   * Proxy base URL, no trailing slash. Only used when `screenshotUpload` is `"branch"`.
   */
  appBaseUrl?: string
  /** Path segment for the screenshot proxy route. Default: "api/bug-screenshots" */
  screenshotProxyPath?: string
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

/** A created GitHub issue. */
export interface CreatedIssue {
  number: number
  url: string
}

/**
 * Interface for the GitHub API layer, enabling test mocking.
 */
export interface GitHubClient {
  searchExistingIssue(fingerprint: string): Promise<ExistingIssue | null>
  createIssue(title: string, body: string, labels: string[]): Promise<CreatedIssue | null>
  addReaction(issueNumber: number): Promise<void>
  reopenIssue(issueNumber: number, comment: string): Promise<void>
  /**
   * Commit an image to `branch` at `path` (creating the branch from the repo's
   * default branch if it doesn't exist). Returns true on success.
   * Prefer `uploadUserAttachment` for new bug reports — GitHub's native
   * user-attachments CDN, same as `gh --attach`.
   */
  uploadImage(opts: {
    branch: string
    path: string
    base64Content: string
    message: string
  }): Promise<boolean>
  /**
   * Upload an image/video as a GitHub user attachment (the same endpoint
   * `gh issue create --attach` uses). Returns the anonymized asset URL to
   * embed in issue markdown, or null on failure.
   */
  uploadUserAttachment(opts: {
    name: string
    contentType: string
    data: Uint8Array
  }): Promise<string | null>
}

/** Who filed a bug report. */
export interface BugReportReporter {
  id: string
  email?: string
  name?: string
  role?: string
}

/** Raw screenshot bytes to attach to a bug report. */
export interface BugReportScreenshot {
  data: Uint8Array
  filename: string
  /** Defaults to "image/png". */
  contentType?: string
}

/** Input to `captureBugReport()`. */
export interface BugReportInput {
  /** User-written description of the problem. */
  message: string
  /** URL of the page the report was filed from. */
  pageUrl: string
  reporter: BugReportReporter
  /** Optional pin location as a percentage of the viewport (0–100). */
  pin?: { x: number; y: number }
  /** Free-form environment metadata rendered into the issue body. */
  metadata?: Record<string, string | number | boolean | null | undefined>
  /** Optional screenshot, uploaded as a GitHub user attachment and embedded. */
  screenshot?: BugReportScreenshot
  /** Extra labels added alongside the default "bug-report" label. */
  labels?: string[]
}

/** Result of `captureBugReport()`. */
export interface BugReportResult {
  issueNumber: number
  issueUrl: string
  screenshotUrl?: string
}

/** Options for `fetchIssueImage()` — the screenshot read-through proxy. */
export interface FetchIssueImageOptions {
  /** GitHub token with contents read on the repo. */
  token: string
  /** Repository in "owner/repo" format. */
  repo: string
  /** Image path of shape `yyyy/mm/<filename>`. */
  path: string
  /** Branch the image was committed to. Default: "bug-report-screenshots" */
  branch?: string
}

/** Result of `fetchIssueImage()`. */
export interface FetchIssueImageResult {
  /** HTTP status to relay (200, 400, 404, 502, 503). */
  status: number
  /** Image bytes, present on 200. */
  body?: ArrayBuffer
  /** MIME type, present on 200. */
  contentType?: string
}
