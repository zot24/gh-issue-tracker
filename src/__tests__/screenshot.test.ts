import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchIssueImage } from '../screenshot'

const mockFetch = vi.fn()

function rawResponse(bytes: number[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response
}

describe('fetchIssueImage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  const base = { token: 'ghp_test', repo: 'owner/repo' }

  it('rejects malformed paths with 400 (no fetch)', async () => {
    expect((await fetchIssueImage({ ...base, path: 'etc/passwd' })).status).toBe(400)
    expect((await fetchIssueImage({ ...base, path: '2026/05/../../secret' })).status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 503 when token or repo is missing', async () => {
    expect((await fetchIssueImage({ token: '', repo: 'owner/repo', path: '2026/05/a.png' })).status).toBe(503)
    expect((await fetchIssueImage({ token: 't', repo: 'bad', path: '2026/05/a.png' })).status).toBe(503)
  })

  it('fetches the raw image with the token and returns bytes + content type', async () => {
    mockFetch.mockResolvedValue(rawResponse([1, 2, 3], 200))

    const res = await fetchIssueImage({ ...base, path: '2026/05/u-1-shot.png' })

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(
      'https://api.github.com/repos/owner/repo/contents/2026/05/u-1-shot.png?ref=bug-report-screenshots',
    )
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_test')
    expect((init.headers as Record<string, string>).Accept).toBe('application/vnd.github.raw')
    expect(res.status).toBe(200)
    expect(res.contentType).toBe('image/png')
    expect(new Uint8Array(res.body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('maps content type from the extension', async () => {
    mockFetch.mockResolvedValue(rawResponse([0], 200))
    expect((await fetchIssueImage({ ...base, path: '2026/05/a.jpg' })).contentType).toBe('image/jpeg')
    expect((await fetchIssueImage({ ...base, path: '2026/05/a.webp' })).contentType).toBe('image/webp')
  })

  it('honors a custom branch', async () => {
    mockFetch.mockResolvedValue(rawResponse([0], 200))
    await fetchIssueImage({ ...base, path: '2026/05/a.png', branch: 'shots' })
    expect(mockFetch.mock.calls[0][0]).toContain('?ref=shots')
  })

  it('returns 404 / 502 from upstream and 502 on network error', async () => {
    mockFetch.mockResolvedValue(rawResponse([], 404))
    expect((await fetchIssueImage({ ...base, path: '2026/05/a.png' })).status).toBe(404)

    mockFetch.mockResolvedValue(rawResponse([], 500))
    expect((await fetchIssueImage({ ...base, path: '2026/05/a.png' })).status).toBe(502)

    mockFetch.mockRejectedValue(new Error('network'))
    expect((await fetchIssueImage({ ...base, path: '2026/05/a.png' })).status).toBe(502)
  })
})
