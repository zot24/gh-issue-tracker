import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GitHubClient, ExistingIssue } from '../types'

// We need to mock the github module before importing client
const mockGitHubClient: GitHubClient = {
  searchExistingIssue: vi.fn(),
  createIssue: vi.fn(),
  addReaction: vi.fn(),
  reopenIssue: vi.fn(),
  uploadImage: vi.fn(),
}

const ISSUE = { number: 123, url: 'https://github.com/owner/repo/issues/123' }

vi.mock('../github', () => ({
  createGitHubClient: vi.fn(() => mockGitHubClient),
}))

// Import after mocks are set up
import {
  init,
  captureException,
  captureMessage,
  captureBugReport,
  flush,
  _reset,
} from '../client'

describe('ErrorTrackerClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _reset()
  })

  afterEach(() => {
    _reset()
  })

  function initTracker(overrides = {}) {
    init({
      githubToken: 'ghp_test',
      githubRepo: 'owner/repo',
      enabled: true,
      ...overrides,
    })
  }

  describe('init', () => {
    it('does not throw when called with valid config', () => {
      expect(() => initTracker()).not.toThrow()
    })
  })

  describe('captureException', () => {
    it('creates a new GitHub issue for an unseen error', async () => {
      vi.mocked(mockGitHubClient.searchExistingIssue).mockResolvedValue(null)
      vi.mocked(mockGitHubClient.createIssue).mockResolvedValue(ISSUE)

      initTracker()
      captureException(new Error('New error'))
      await flush()

      expect(mockGitHubClient.searchExistingIssue).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9]{12}$/)
      )
      expect(mockGitHubClient.createIssue).toHaveBeenCalledWith(
        expect.stringContaining('[Error]'),
        expect.stringContaining('New error'),
        expect.arrayContaining(['error-report'])
      )
    })

    it('adds a reaction to an existing open issue', async () => {
      const existingIssue: ExistingIssue = {
        number: 42,
        state: 'open',
        title: '[Error] Old error',
      }
      vi.mocked(mockGitHubClient.searchExistingIssue).mockResolvedValue(existingIssue)

      initTracker()
      captureException(new Error('Old error'))
      await flush()

      expect(mockGitHubClient.addReaction).toHaveBeenCalledWith(42)
      expect(mockGitHubClient.createIssue).not.toHaveBeenCalled()
    })

    it('reopens a closed issue when reopenClosed is true', async () => {
      const closedIssue: ExistingIssue = {
        number: 55,
        state: 'closed',
        title: '[Error] Fixed error',
      }
      vi.mocked(mockGitHubClient.searchExistingIssue).mockResolvedValue(closedIssue)

      initTracker({ reopenClosed: true })
      captureException(new Error('Fixed error'))
      await flush()

      expect(mockGitHubClient.reopenIssue).toHaveBeenCalledWith(
        55,
        expect.stringContaining('Recurrence detected')
      )
      expect(mockGitHubClient.addReaction).toHaveBeenCalledWith(55)
    })

    it('skips closed issues when reopenClosed is false', async () => {
      const closedIssue: ExistingIssue = {
        number: 55,
        state: 'closed',
        title: '[Error] Fixed error',
      }
      vi.mocked(mockGitHubClient.searchExistingIssue).mockResolvedValue(closedIssue)

      initTracker({ reopenClosed: false })
      captureException(new Error('Fixed error'))
      await flush()

      expect(mockGitHubClient.reopenIssue).not.toHaveBeenCalled()
      expect(mockGitHubClient.createIssue).not.toHaveBeenCalled()
    })

    it('does nothing when disabled', async () => {
      initTracker({ enabled: false })
      captureException(new Error('Ignored'))
      await flush()

      expect(mockGitHubClient.searchExistingIssue).not.toHaveBeenCalled()
    })

    it('includes context tags in the issue body', async () => {
      vi.mocked(mockGitHubClient.searchExistingIssue).mockResolvedValue(null)
      vi.mocked(mockGitHubClient.createIssue).mockResolvedValue(ISSUE)

      initTracker()
      captureException(new Error('Tagged error'), {
        tags: { route: '/api/v1/users', method: 'POST' },
        requestUrl: '/api/v1/users',
      })
      await flush()

      const body = vi.mocked(mockGitHubClient.createIssue).mock.calls[0]?.[1]
      expect(body).toContain('route')
      expect(body).toContain('/api/v1/users')
    })
  })

  describe('captureMessage', () => {
    it('creates an issue from a plain message', async () => {
      vi.mocked(mockGitHubClient.searchExistingIssue).mockResolvedValue(null)
      vi.mocked(mockGitHubClient.createIssue).mockResolvedValue(ISSUE)

      initTracker()
      captureMessage('Something unusual happened', 'warning')
      await flush()

      expect(mockGitHubClient.createIssue).toHaveBeenCalledWith(
        expect.stringContaining('[Warning]'),
        expect.stringContaining('Something unusual happened'),
        expect.arrayContaining(['error-report'])
      )
    })
  })

  describe('captureBugReport', () => {
    it('creates a bug-report issue and returns the issue ref', async () => {
      vi.mocked(mockGitHubClient.createIssue).mockResolvedValue(ISSUE)

      initTracker()
      const result = await captureBugReport({
        message: 'The save button does nothing on the bookings page',
        pageUrl: 'https://app.example.com/bookings',
        reporter: { id: 'u1', name: 'Dewi', role: 'host' },
        metadata: { viewport: '1440 × 900' },
      })

      expect(mockGitHubClient.createIssue).toHaveBeenCalledWith(
        expect.stringContaining('[Bug Report]'),
        expect.stringContaining('save button'),
        expect.arrayContaining(['bug-report'])
      )
      // No screenshot provided → no upload.
      expect(mockGitHubClient.uploadImage).not.toHaveBeenCalled()
      expect(result).toEqual({
        issueNumber: 123,
        issueUrl: ISSUE.url,
        screenshotUrl: undefined,
      })
    })

    it('uploads a screenshot and embeds the proxy URL when appBaseUrl is set', async () => {
      vi.mocked(mockGitHubClient.createIssue).mockResolvedValue(ISSUE)
      vi.mocked(mockGitHubClient.uploadImage).mockResolvedValue(true)

      initTracker({ appBaseUrl: 'https://app.example.com' })
      const result = await captureBugReport({
        message: 'Layout breaks in the export modal when the list is long',
        pageUrl: 'https://app.example.com/expenses',
        reporter: { id: 'u1' },
        screenshot: { data: new Uint8Array([65, 66, 67]), filename: 'screenshot.png' },
      })

      expect(mockGitHubClient.uploadImage).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: 'bug-report-screenshots',
          base64Content: 'QUJD', // base64("ABC")
        })
      )
      const body = vi.mocked(mockGitHubClient.createIssue).mock.calls[0]?.[1]
      expect(body).toContain('![Screenshot](https://app.example.com/api/bug-screenshots/')
      expect(result?.screenshotUrl).toContain('https://app.example.com/api/bug-screenshots/')
    })

    it('returns null when disabled', async () => {
      initTracker({ enabled: false })
      const result = await captureBugReport({
        message: 'x'.repeat(60),
        pageUrl: 'https://app.example.com/',
        reporter: { id: 'u1' },
      })
      expect(result).toBeNull()
      expect(mockGitHubClient.createIssue).not.toHaveBeenCalled()
    })
  })

  describe('flush', () => {
    it('resolves even when no pending operations exist', async () => {
      initTracker()
      await expect(flush()).resolves.toBeUndefined()
    })
  })
})
