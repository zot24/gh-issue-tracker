/**
 * Browser entry — `gh-issue-tracker/browser`.
 *
 * Client-side helpers for collecting a bug report (screenshot + metadata) and
 * POSTing it to your own API route, which then calls `captureBugReport` on the
 * server (so the GitHub token never reaches the browser).
 *
 * `captureScreenshot` dynamically imports `modern-screenshot`, which is an
 * OPTIONAL peer dependency — install it only if you use screenshots. The server
 * entry (`gh-issue-tracker`) stays dependency-free.
 */

export interface CaptureScreenshotOptions {
  /**
   * Element to capture. Defaults to `[data-screenshot-target]` if present,
   * otherwise `document.body`.
   */
  target?: HTMLElement
  /** Downscale factor (0–1). Default 0.5 keeps payloads small. */
  scale?: number
  /** JPEG quality (0–1). Default 0.75. */
  quality?: number
  /**
   * Selectors hidden during capture (e.g. the bug widget itself) so they don't
   * appear in the screenshot. Restored afterwards.
   */
  hideSelectors?: string[]
}

export interface CapturedScreenshot {
  /** JPEG file ready to append to FormData. */
  file: File
  /** Data URL for an inline preview. */
  preview: string
}

/**
 * Capture the current page (including any open modal/dialog) as a JPEG using
 * `modern-screenshot`. Returns null if capture fails or runs outside a browser.
 */
export async function captureScreenshot(
  options: CaptureScreenshotOptions = {},
): Promise<CapturedScreenshot | null> {
  if (typeof document === 'undefined') return null

  const hideSelectors = options.hideSelectors ?? ['[data-bug-report]', '[data-pin-overlay]']
  const hidden: HTMLElement[] = []

  try {
    const { domToJpeg } = await import('modern-screenshot')

    for (const sel of hideSelectors) {
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        el.style.visibility = 'hidden'
        hidden.push(el)
      })
    }

    const target =
      options.target ??
      document.querySelector<HTMLElement>('[data-screenshot-target]') ??
      document.body

    const dataUrl = await domToJpeg(target, {
      scale: options.scale ?? 0.5,
      quality: options.quality ?? 0.75,
    })
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], 'screenshot.jpg', { type: 'image/jpeg' })
    return { file, preview: dataUrl }
  } catch (err) {
    console.error('[gh-issue-tracker] screenshot capture failed:', err)
    return null
  } finally {
    for (const el of hidden) el.style.visibility = ''
  }
}

export interface SubmitBugReportInput {
  /** Endpoint that calls `captureBugReport` on the server. */
  endpoint: string
  message: string
  screenshot?: File | null
  /** Pin location as a percentage of the viewport (0–100). */
  pin?: { x: number; y: number }
  /** Extra fields appended to the multipart form. */
  extra?: Record<string, string | number | undefined>
  /** Passed to fetch (e.g. credentials, headers). */
  fetchInit?: RequestInit
}

export interface SubmitBugReportResult {
  ok: boolean
  status: number
  issueNumber?: number
  issueUrl?: string
  error?: string
}

/**
 * Build the multipart form for a bug report, auto-collecting browser/environment
 * metadata (viewport, screen, UA, language, timezone, connection, referrer).
 */
export function buildBugReportFormData(input: SubmitBugReportInput): FormData {
  const form = new FormData()
  form.append('message', input.message)
  form.append('pageUrl', window.location.href)
  if (input.pin) {
    form.append('pinX', String(input.pin.x))
    form.append('pinY', String(input.pin.y))
  }
  form.append('userAgent', navigator.userAgent)
  form.append('viewportWidth', String(window.innerWidth))
  form.append('viewportHeight', String(window.innerHeight))
  if (document.title) form.append('pageTitle', document.title)
  form.append('screenWidth', String(screen.width))
  form.append('screenHeight', String(screen.height))
  form.append('devicePixelRatio', String(window.devicePixelRatio))
  form.append('language', navigator.language)
  form.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection
  if (connection?.effectiveType) form.append('connectionType', connection.effectiveType)
  if (document.referrer) form.append('referrer', document.referrer)
  for (const [k, v] of Object.entries(input.extra ?? {})) {
    if (v !== undefined) form.append(k, String(v))
  }
  if (input.screenshot) form.append('screenshot', input.screenshot, 'screenshot.jpg')
  return form
}

/** Build the form and POST it to your bug-report endpoint. */
export async function submitBugReport(
  input: SubmitBugReportInput,
): Promise<SubmitBugReportResult> {
  const form = buildBugReportFormData(input)
  try {
    const res = await fetch(input.endpoint, {
      method: 'POST',
      body: form,
      ...input.fetchInit,
    })
    const data = (await res.json().catch(() => null)) as
      | { issueNumber?: number; issueUrl?: string; error?: string }
      | null
    return {
      ok: res.ok,
      status: res.status,
      issueNumber: data?.issueNumber,
      issueUrl: data?.issueUrl,
      error: res.ok ? undefined : (data?.error ?? `HTTP ${res.status}`),
    }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' }
  }
}
