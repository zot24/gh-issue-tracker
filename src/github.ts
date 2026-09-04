/**
 * GitHub API layer for error tracking.
 *
 * A tiny `fetch`-based GitHub REST client — no SDK dependency, so it runs on any
 * runtime with a global `fetch` (Node 20+, edge functions, Cloudflare Workers,
 * Deno). All methods catch errors internally and delegate to `onError`; they
 * never throw, so the tracker can never crash the host application.
 */

import type { GitHubClient, ExistingIssue, CreatedIssue } from './types'

export interface GitHubClientConfig {
  token: string
  repo: string // "owner/repo"
  onError: (err: unknown) => void
}

const API_BASE = 'https://api.github.com'
const UPLOADS_BASE = 'https://uploads.github.com'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/')
  if (!owner || !name) {
    throw new Error(`Invalid repo format "${repo}". Expected "owner/repo".`)
  }
  return { owner, repo: name }
}

export function createGitHubClient(config: GitHubClientConfig): GitHubClient {
  const { owner, repo } = parseRepo(config.repo)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects requests without a User-Agent.
    'User-Agent': 'gh-issue-tracker',
    'Content-Type': 'application/json',
  }

  /** Low-level fetch — returns the Response without throwing, for callers that
   *  need to inspect the status (e.g. a 404 means "branch missing, create it"). */
  function ghFetch(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  /** Fetch + throw on error + parse JSON, for the happy-path calls. */
  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await ghFetch(method, path, body)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `GitHub ${method} ${path} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
      )
    }
    if (res.status === 204) return null
    return res.json().catch(() => null)
  }

  /** Ensure `branch` exists, creating it from the repo's default branch if not. */
  async function ensureBranch(branch: string): Promise<void> {
    const head = await ghFetch('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`)
    if (head.ok) return
    if (head.status !== 404) {
      throw new Error(`GitHub get ref heads/${branch} failed: ${head.status} ${head.statusText}`)
    }
    // Branch doesn't exist yet — branch it off the repo's default branch.
    const repoInfo = (await request('GET', `/repos/${owner}/${repo}`)) as { default_branch: string }
    const defRef = (await request(
      'GET',
      `/repos/${owner}/${repo}/git/ref/heads/${repoInfo.default_branch}`,
    )) as { object: { sha: string } }
    await request('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: defRef.object.sha,
    })
  }

  let repositoryId: number | undefined

  async function resolveRepositoryId(): Promise<number> {
    if (repositoryId !== undefined) return repositoryId
    const info = (await request('GET', `/repos/${owner}/${repo}`)) as { id: number }
    if (!info?.id) {
      throw new Error(`GitHub GET /repos/${owner}/${repo} returned no repository id`)
    }
    repositoryId = info.id
    return repositoryId
  }

  return {
    async searchExistingIssue(fingerprint: string): Promise<ExistingIssue | null> {
      try {
        const query = new URLSearchParams({
          labels: `fingerprint:${fingerprint}`,
          state: 'all',
          per_page: '1',
        })
        const data = (await request(
          'GET',
          `/repos/${owner}/${repo}/issues?${query.toString()}`,
        )) as Array<{ number: number; state: string; title: string }> | null

        const issue = data?.[0]
        if (!issue) return null

        return {
          number: issue.number,
          state: issue.state as 'open' | 'closed',
          title: issue.title,
        }
      } catch (err) {
        config.onError(err)
        return null
      }
    },

    async createIssue(title: string, body: string, labels: string[]): Promise<CreatedIssue | null> {
      try {
        const data = (await request('POST', `/repos/${owner}/${repo}/issues`, {
          title,
          body,
          labels,
        })) as { number: number; html_url: string } | null
        if (!data) return null
        return { number: data.number, url: data.html_url }
      } catch (err) {
        config.onError(err)
        return null
      }
    },

    async addReaction(issueNumber: number): Promise<void> {
      try {
        await request('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/reactions`, {
          content: '+1',
        })
      } catch (err) {
        config.onError(err)
      }
    },

    async reopenIssue(issueNumber: number, comment: string): Promise<void> {
      try {
        await request('PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, {
          state: 'open',
        })
        await request('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
          body: comment,
        })
      } catch (err) {
        config.onError(err)
      }
    },

    async uploadImage({ branch, path, base64Content, message }): Promise<boolean> {
      try {
        await ensureBranch(branch)
        await request('PUT', `/repos/${owner}/${repo}/contents/${path}`, {
          message,
          content: base64Content,
          branch,
        })
        return true
      } catch (err) {
        config.onError(err)
        return false
      }
    },

    async uploadUserAttachment({ name, contentType, data }): Promise<string | null> {
      try {
        if (data.byteLength === 0) {
          throw new Error(`attachment "${name}" is empty`)
        }
        if (data.byteLength > MAX_IMAGE_BYTES) {
          throw new Error(
            `attachment "${name}" is ${data.byteLength} bytes; images must be at most ${MAX_IMAGE_BYTES}`,
          )
        }

        const filename = name.split(/[/\\]/).pop() || 'screenshot.png'
        const repoId = await resolveRepositoryId()
        const params = new URLSearchParams({
          name: filename,
          content_type: contentType,
          repository_id: String(repoId),
        })

        const bytes = new Uint8Array(data.byteLength)
        bytes.set(data)

        const res = await fetch(`${UPLOADS_BASE}/user-attachments/assets?${params.toString()}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'gh-issue-tracker',
            'Content-Type': 'application/octet-stream',
          },
          body: bytes.buffer,
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(
            `GitHub POST /user-attachments/assets failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
          )
        }
        const payload = (await res.json().catch(() => null)) as { url?: string } | null
        if (!payload?.url) {
          throw new Error('GitHub user-attachment upload returned no asset URL')
        }
        return payload.url
      } catch (err) {
        config.onError(err)
        return null
      }
    },
  }
}
