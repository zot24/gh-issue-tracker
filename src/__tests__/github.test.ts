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
    it('creates an issue and returns its number and url', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(
          { number: 99, html_url: 'https://github.com/owner/repo/issues/99' },
          201,
        ),
      )

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
      expect(result).toEqual({
        number: 99,
        url: 'https://github.com/owner/repo/issues/99',
      })
    })

    it('returns null and calls onError on failure', async () => {
      mockFetch.mockResolvedValue(errorResponse(403))

      const client = makeClient()
      const result = await client.createIssue('title', 'body', [])

      expect(result).toBeNull()
      expect(onError).toHaveBeenCalled()
    })
  })

  describe('uploadImage', () => {
    it('commits the image when the branch already exists', async () => {
      // 1) GET ref heads/<branch> -> 200 (exists), 2) PUT contents -> 201
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/shots' }, 200))
        .mockResolvedValueOnce(jsonResponse({ content: { path: 'x' } }, 201))

      const client = makeClient()
      const ok = await client.uploadImage({
        branch: 'shots',
        path: '2026/05/u-1-screenshot.png',
        base64Content: 'QUJD',
        message: 'add screenshot',
      })

      expect(ok).toBe(true)
      const getRef = call(0)
      expect(getRef.init.method).toBe('GET')
      expect(getRef.url).toBe('https://api.github.com/repos/owner/repo/git/ref/heads/shots')
      const put = call(1)
      expect(put.init.method).toBe('PUT')
      expect(put.url).toBe(
        'https://api.github.com/repos/owner/repo/contents/2026/05/u-1-screenshot.png',
      )
      expect(JSON.parse(put.init.body as string)).toEqual({
        message: 'add screenshot',
        content: 'QUJD',
        branch: 'shots',
      })
    })

    it('creates the branch from the default branch when missing, then commits', async () => {
      mockFetch
        // GET ref heads/shots -> 404 (missing)
        .mockResolvedValueOnce(errorResponse(404, 'Not Found'))
        // GET repo -> default_branch
        .mockResolvedValueOnce(jsonResponse({ default_branch: 'main' }, 200))
        // GET ref heads/main -> sha
        .mockResolvedValueOnce(jsonResponse({ object: { sha: 'deadbeef' } }, 200))
        // POST git/refs -> created
        .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/shots' }, 201))
        // PUT contents -> committed
        .mockResolvedValueOnce(jsonResponse({ content: {} }, 201))

      const client = makeClient()
      const ok = await client.uploadImage({
        branch: 'shots',
        path: '2026/05/u-1-screenshot.png',
        base64Content: 'QUJD',
        message: 'add screenshot',
      })

      expect(ok).toBe(true)
      const createRef = call(3)
      expect(createRef.init.method).toBe('POST')
      expect(createRef.url).toBe('https://api.github.com/repos/owner/repo/git/refs')
      expect(JSON.parse(createRef.init.body as string)).toEqual({
        ref: 'refs/heads/shots',
        sha: 'deadbeef',
      })
      expect(call(4).init.method).toBe('PUT')
    })

    it('returns false and calls onError when the commit fails', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/shots' }, 200))
        .mockResolvedValueOnce(errorResponse(403, 'Forbidden'))

      const client = makeClient()
      const ok = await client.uploadImage({
        branch: 'shots',
        path: '2026/05/u-1-screenshot.png',
        base64Content: 'QUJD',
        message: 'add screenshot',
      })

      expect(ok).toBe(false)
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
