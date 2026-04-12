import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GitHubClient, ExistingIssue } from '../types'

// We need to mock the github module before importing client
const mockGitHubClient: GitHubClient = {
  searchExistingIssue: vi.fn(),
  createIssue: vi.fn(),
  addReaction: vi.fn(),
  reopenIssue: vi.fn(),
}

vi.mock('../github', () => ({
  createGitHubClient: vi.fn(() => mockGitHubClient),
}))

// Import after mocks are set up
import { init, captureException, captureMessage, flush, _reset } from '../client'

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
      vi.mocked(mockGitHubClient.createIssue).mockResolvedValue(123)

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
      vi.mocked(mockGitHubClient.createIssue).mockResolvedValue(1)

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
      vi.mocked(mockGitHubClient.createIssue).mockResolvedValue(1)

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

  describe('flush', () => {
    it('resolves even when no pending operations exist', async () => {
      initTracker()
      await expect(flush()).resolves.toBeUndefined()
    })
  })
})
