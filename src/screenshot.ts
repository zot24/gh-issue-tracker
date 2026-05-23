/**
 * Screenshot read-through proxy.
 *
 * Screenshots attached by `captureBugReport` are committed to a branch in the
 * repo. For PRIVATE repos, `raw.githubusercontent.com` 404s anonymously and the
 * signed `?token=` URL is short-lived, so an issue body can't embed them
 * directly. `fetchIssueImage` fetches the bytes server-side with the token; wrap
 * its result in your framework's Response (see the README for a Next.js route).
 *
 * Edge-native: uses only `fetch`, so it runs on Node 20+, edge, and Workers.
 */

import type { FetchIssueImageOptions, FetchIssueImageResult } from './types'
import { DEFAULT_SCREENSHOT_BRANCH } from './bug-report'

// Strict shape `yyyy/mm/<filename>`; filename has no slashes, so traversal is
// impossible. The explicit `..` check is belt-and-suspenders.
const PATH_SHAPE = /^\d{4}\/\d{2}\/[\w.-]+$/

function contentTypeFor(filepath: string): string {
  const ext = filepath.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

export async function fetchIssueImage(
  opts: FetchIssueImageOptions,
): Promise<FetchIssueImageResult> {
  const branch = opts.branch ?? DEFAULT_SCREENSHOT_BRANCH

  if (!PATH_SHAPE.test(opts.path) || opts.path.includes('..')) {
    return { status: 400 }
  }

  const [owner, repo] = opts.repo.split('/')
  if (!owner || !repo || !opts.token) {
    return { status: 503 }
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${opts.path}?ref=${branch}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/vnd.github.raw',
        'User-Agent': 'gh-issue-tracker',
      },
    })
  } catch {
    return { status: 502 }
  }

  if (res.status === 404) return { status: 404 }
  if (!res.ok) return { status: 502 }

  const body = await res.arrayBuffer()
  return { status: 200, body, contentType: contentTypeFor(opts.path) }
}
