import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGitHubClient } from '../github'

// The client uses the global `fetch` directly (no SDK), so we mock it.
const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function errorResponse(status: number, statusText = 'Error'): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({}),
    text: async () => 'error detail',
  } as unknown as Response
}

describe('createGitHubClient', () => {
  const onError = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    onError.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeClient() {
    return createGitHubClient({
      token: 'ghp_test',
      repo: 'owner/repo',
      onError,
    })
  }

  /** Pull the [url, init] of the nth fetch call. */
  function call(n = 0): { url: string; init: RequestInit } {
    const [url, init] = mockFetch.mock.calls[n]
    return { url, init }
  }

  describe('searchExistingIssue', () => {
    it('returns an open issue when found', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse([{ number: 42, state: 'open', title: '[Error] Something broke' }]),
      )

      const client = makeClient()
      const result = await client.searchExistingIssue('abc123def456')

      const { url, init } = call()
      expect(init.method).toBe('GET')
      expect(url).toContain('/repos/owner/repo/issues')
      expect(url).toContain('labels=fingerprint%3Aabc123def456')
      expect(url).toContain('state=all')
      expect(url).toContain('per_page=1')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_test')
      expect(result).toEqual({
        number: 42,
        state: 'open',
        title: '[Error] Something broke',
      })
    })

    it('returns null when no issue found', async () => {
      mockFetch.mockResolvedValue(jsonResponse([]))

      const client = makeClient()
      const result = await client.searchExistingIssue('abc123def456')

      expect(result).toBeNull()
    })

    it('returns null and calls onError on API failure', async () => {
      mockFetch.mockResolvedValue(errorResponse(403, 'Forbidden'))

      const client = makeClient()
      const result = await client.searchExistingIssue('abc123def456')

      expect(result).toBeNull()
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })

    it('returns null and calls onError when fetch rejects', async () => {
      mockFetch.mockRejectedValue(new Error('network down'))

      const client = makeClient()
      const result = await client.searchExistingIssue('abc123def456')

      expect(result).toBeNull()
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('createIssue', () => {
    it('creates an issue and returns the issue number', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ number: 99 }, 201))

      const client = makeClient()
      const result = await client.createIssue(
        '[Error] TypeError',
        'Error body here',
        ['error-report', 'fingerprint:abc'],
      )

      const { url, init } = call()
      expect(init.method).toBe('POST')
      expect(url).toBe('https://api.github.com/repos/owner/repo/issues')
      expect(JSON.parse(init.body as string)).toEqual({
        title: '[Error] TypeError',
        body: 'Error body here',
        labels: ['error-report', 'fingerprint:abc'],
      })
      expect(result).toBe(99)
    })

    it('returns null and calls onError on failure', async () => {
      mockFetch.mockResolvedValue(errorResponse(403))

      const client = makeClient()
      const result = await client.createIssue('title', 'body', [])

      expect(result).toBeNull()
      expect(onError).toHaveBeenCalled()
    })
  })

  describe('addReaction', () => {
    it('adds a thumbs-up reaction', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 1 }, 201))

      const client = makeClient()
      await client.addReaction(42)

      const { url, init } = call()
      expect(init.method).toBe('POST')
      expect(url).toBe('https://api.github.com/repos/owner/repo/issues/42/reactions')
      expect(JSON.parse(init.body as string)).toEqual({ content: '+1' })
    })

    it('calls onError on failure without throwing', async () => {
      mockFetch.mockResolvedValue(errorResponse(429, 'Too Many Requests'))

      const client = makeClient()
      await client.addReaction(42) // should not throw

      expect(onError).toHaveBeenCalled()
    })
  })

  describe('reopenIssue', () => {
    it('reopens the issue and adds a comment', async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 200))

      const client = makeClient()
      await client.reopenIssue(42, 'Recurred at 2026-04-04')

      const patch = call(0)
      expect(patch.init.method).toBe('PATCH')
      expect(patch.url).toBe('https://api.github.com/repos/owner/repo/issues/42')
      expect(JSON.parse(patch.init.body as string)).toEqual({ state: 'open' })

      const comment = call(1)
      expect(comment.init.method).toBe('POST')
      expect(comment.url).toBe('https://api.github.com/repos/owner/repo/issues/42/comments')
      expect(JSON.parse(comment.init.body as string)).toEqual({ body: 'Recurred at 2026-04-04' })
    })

    it('calls onError on failure without throwing', async () => {
      mockFetch.mockResolvedValue(errorResponse(404, 'Not Found'))

      const client = makeClient()
      await client.reopenIssue(42, 'recurrence')

      expect(onError).toHaveBeenCalled()
    })
  })
})
