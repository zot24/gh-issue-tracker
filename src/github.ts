/**
 * GitHub API layer for error tracking.
 *
 * All methods catch errors internally and delegate to `onError` —
 * they never throw. This ensures the error tracker itself never
 * crashes the host application.
 */

import { Octokit } from 'octokit'
import type { GitHubClient, ExistingIssue } from './types'

export interface GitHubClientConfig {
  token: string
  repo: string // "owner/repo"
  onError: (err: unknown) => void
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/')
  if (!owner || !name) {
    throw new Error(`Invalid repo format "${repo}". Expected "owner/repo".`)
  }
  return { owner, repo: name }
}

export function createGitHubClient(config: GitHubClientConfig): GitHubClient {
  const octokit = new Octokit({ auth: config.token })
  const { owner, repo } = parseRepo(config.repo)

  return {
    async searchExistingIssue(fingerprint: string): Promise<ExistingIssue | null> {
      try {
        const { data } = await octokit.rest.issues.listForRepo({
          owner,
          repo,
          labels: `fingerprint:${fingerprint}`,
          state: 'all',
          per_page: 1,
        })

        const issue = data[0]
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

    async createIssue(title: string, body: string, labels: string[]): Promise<number | null> {
      try {
        const { data } = await octokit.rest.issues.create({
          owner,
          repo,
          title,
          body,
          labels,
        })
        return data.number
      } catch (err) {
        config.onError(err)
        return null
      }
    },

    async addReaction(issueNumber: number): Promise<void> {
      try {
        await octokit.rest.reactions.createForIssue({
          owner,
          repo,
          issue_number: issueNumber,
          content: '+1',
        })
      } catch (err) {
        config.onError(err)
      }
    },

    async reopenIssue(issueNumber: number, comment: string): Promise<void> {
      try {
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: issueNumber,
          state: 'open',
        })
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: comment,
        })
      } catch (err) {
        config.onError(err)
      }
    },
  }
}
