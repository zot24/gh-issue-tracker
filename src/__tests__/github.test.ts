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

  describe('uploadUserAttachment', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const assetUrl = 'https://github.com/user-attachments/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

    it('POSTs the bytes to uploads.github.com and returns the asset URL', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 4242 }, 200))
        .mockResolvedValueOnce(jsonResponse({ url: assetUrl }, 201))

      const client = makeClient()
      const url = await client.uploadUserAttachment({
        name: 'screenshot.png',
        contentType: 'image/png',
        data: png,
      })

      expect(url).toBe(assetUrl)

      const repo = call(0)
      expect(repo.init.method).toBe('GET')
      expect(repo.url).toBe('https://api.github.com/repos/owner/repo')

      const upload = call(1)
      expect(upload.init.method).toBe('POST')
      expect(upload.url).toBe(
        'https://uploads.github.com/user-attachments/assets?name=screenshot.png&content_type=image%2Fpng&repository_id=4242',
      )
      expect((upload.init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/octet-stream',
      )
      expect((upload.init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_test')
      expect((upload.init.headers as Record<string, string>).Accept).toBe(
        'application/vnd.github+json',
      )
      expect(new Uint8Array(upload.init.body as ArrayBuffer)).toEqual(png)
    })

    it('caches the repository id so a second upload skips the lookup', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 4242 }, 200))
        .mockResolvedValueOnce(jsonResponse({ url: assetUrl }, 201))
        .mockResolvedValueOnce(jsonResponse({ url: `${assetUrl}-2` }, 201))

      const client = makeClient()
      await client.uploadUserAttachment({
        name: 'a.png',
        contentType: 'image/png',
        data: png,
      })
      await client.uploadUserAttachment({
        name: 'b.png',
        contentType: 'image/png',
        data: png,
      })

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(call(0).url).toBe('https://api.github.com/repos/owner/repo')
      expect(call(1).url).toContain('name=a.png')
      expect(call(2).url).toContain('name=b.png')
    })

    it('strips directory components from the filename', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 7 }, 200))
        .mockResolvedValueOnce(jsonResponse({ url: assetUrl }, 201))

      const client = makeClient()
      await client.uploadUserAttachment({
        name: 'foo/bar/shot.png',
        contentType: 'image/png',
        data: png,
      })

      expect(call(1).url).toContain('name=shot.png')
      expect(call(1).url).not.toContain('foo')
    })

    it('returns null and calls onError when the upload fails', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 4242 }, 200))
        .mockResolvedValueOnce(errorResponse(404, 'Not Found'))

      const client = makeClient()
      const url = await client.uploadUserAttachment({
        name: 'screenshot.png',
        contentType: 'image/png',
        data: png,
      })

      expect(url).toBeNull()
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })

    it('returns null and calls onError when the server omits the asset URL', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ id: 4242 }, 200))
        .mockResolvedValueOnce(jsonResponse({}, 201))

      const client = makeClient()
      const url = await client.uploadUserAttachment({
        name: 'screenshot.png',
        contentType: 'image/png',
        data: png,
      })

      expect(url).toBeNull()
      expect(onError).toHaveBeenCalled()
    })

    it('rejects empty files without hitting the network', async () => {
      const client = makeClient()
      const url = await client.uploadUserAttachment({
        name: 'empty.png',
        contentType: 'image/png',
        data: new Uint8Array(),
      })

      expect(url).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalled()
    })

    it('rejects images larger than 10MB without hitting the network', async () => {
      const client = makeClient()
      const url = await client.uploadUserAttachment({
        name: 'huge.png',
        contentType: 'image/png',
        data: new Uint8Array(10 * 1024 * 1024 + 1),
      })

      expect(url).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
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
