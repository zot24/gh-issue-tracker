import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGitHubClient } from '../github'

// Mock octokit at module level
const mockListForRepo = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockCreateComment = vi.fn()
const mockCreateReaction = vi.fn()

vi.mock('octokit', () => {
  // Must use a function (not arrow) so `new Octokit()` works
  function MockOctokit() {
    return {
      rest: {
        issues: {
          listForRepo: mockListForRepo,
          create: mockCreate,
          update: mockUpdate,
          createComment: mockCreateComment,
        },
        reactions: {
          createForIssue: mockCreateReaction,
        },
      },
    }
  }
  return { Octokit: MockOctokit }
})

describe('createGitHubClient', () => {
  const onError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    onError.mockClear()
  })

  function makeClient() {
    return createGitHubClient({
      token: 'ghp_test',
      repo: 'owner/repo',
      onError,
    })
  }

  describe('searchExistingIssue', () => {
    it('returns an open issue when found', async () => {
      mockListForRepo.mockResolvedValue({
        data: [
          { number: 42, state: 'open', title: '[Error] Something broke' },
        ],
      })

      const client = makeClient()
      const result = await client.searchExistingIssue('abc123def456')

      expect(mockListForRepo).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        labels: 'fingerprint:abc123def456',
        state: 'all',
        per_page: 1,
      })
      expect(result).toEqual({
        number: 42,
        state: 'open',
        title: '[Error] Something broke',
      })
    })

    it('returns null when no issue found', async () => {
      mockListForRepo.mockResolvedValue({ data: [] })

      const client = makeClient()
      const result = await client.searchExistingIssue('abc123def456')

      expect(result).toBeNull()
    })

    it('returns null and calls onError on API failure', async () => {
      mockListForRepo.mockRejectedValue(new Error('API rate limit'))

      const client = makeClient()
      const result = await client.searchExistingIssue('abc123def456')

      expect(result).toBeNull()
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('createIssue', () => {
    it('creates an issue and returns the issue number', async () => {
      mockCreate.mockResolvedValue({ data: { number: 99 } })

      const client = makeClient()
      const result = await client.createIssue(
        '[Error] TypeError',
        'Error body here',
        ['error-report', 'fingerprint:abc']
      )

      expect(mockCreate).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        title: '[Error] TypeError',
        body: 'Error body here',
        labels: ['error-report', 'fingerprint:abc'],
      })
      expect(result).toBe(99)
    })

    it('returns null and calls onError on failure', async () => {
      mockCreate.mockRejectedValue(new Error('forbidden'))

      const client = makeClient()
      const result = await client.createIssue('title', 'body', [])

      expect(result).toBeNull()
      expect(onError).toHaveBeenCalled()
    })
  })

  describe('addReaction', () => {
    it('adds a thumbs-up reaction', async () => {
      mockCreateReaction.mockResolvedValue({ data: {} })

      const client = makeClient()
      await client.addReaction(42)

      expect(mockCreateReaction).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        content: '+1',
      })
    })

    it('calls onError on failure without throwing', async () => {
      mockCreateReaction.mockRejectedValue(new Error('rate limited'))

      const client = makeClient()
      await client.addReaction(42) // should not throw

      expect(onError).toHaveBeenCalled()
    })
  })

  describe('reopenIssue', () => {
    it('reopens the issue and adds a comment', async () => {
      mockUpdate.mockResolvedValue({ data: {} })
      mockCreateComment.mockResolvedValue({ data: {} })

      const client = makeClient()
      await client.reopenIssue(42, 'Recurred at 2026-04-04')

      expect(mockUpdate).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        state: 'open',
      })
      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'Recurred at 2026-04-04',
      })
    })

    it('calls onError on failure without throwing', async () => {
      mockUpdate.mockRejectedValue(new Error('not found'))

      const client = makeClient()
      await client.reopenIssue(42, 'recurrence')

      expect(onError).toHaveBeenCalled()
    })
  })
})
