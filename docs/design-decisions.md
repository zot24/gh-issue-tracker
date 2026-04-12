# Design Decisions

## Overview

`gh-issue-tracker` is a lightweight error tracking package that reports errors as GitHub Issues instead of sending them to SaaS platforms like Sentry. This document captures the key design decisions and trade-offs.

## Decision: GitHub Issues as the error store

**Context**: Error tracking SaaS platforms (Sentry, Bugsnag, Datadog) provide comprehensive error monitoring but add cost, dependency, and complexity. For many projects, errors are already triaged and tracked alongside code — GitHub Issues is a natural fit.

**Choice**: Use the GitHub Issues API (via Octokit) to create, deduplicate, and manage error reports directly in the repository.

**Consequences**:
- Zero SaaS cost
- Errors visible alongside code, PRs, and project boards
- Limited by GitHub API rate limits (5,000 req/hr authenticated)
- No session replay or performance tracing

## Decision: SHA-256 fingerprinting with normalized stack frames

**Context**: Errors need a stable identity so the same logical error doesn't create duplicate issues across deployments. Line numbers change between deploys, webpack hashes change, and query strings vary.

**Choice**: Generate a fingerprint by hashing:
1. Error name (e.g., `TypeError`)
2. Error message (first 100 characters)
3. Top 3 stack frames, normalized by stripping:
   - Line:column numbers (`:42:13`)
   - Webpack internal prefixes (`webpack-internal:///`)
   - Query strings (`?abc123`)
   - Node modules frames (skipped entirely)

The SHA-256 hash is truncated to 12 hex characters and stored as a GitHub label (`fingerprint:abc123def456`).

**Consequences**:
- Same error across deploys produces the same fingerprint
- Errors with dynamic messages (timestamps, IDs) in the first 100 chars may produce different fingerprints
- 12-char hex provides ~48 bits of entropy — collision probability is negligible for issue volumes
- GitHub label search enables O(1) dedup lookups

## Decision: Two-layer deduplication

**Context**: Without deduplication, a single error in a loop could create hundreds of GitHub issues in seconds.

**Choice**: Two independent layers:
1. **In-memory rate limiter**: Sliding window (max N new issues/minute) + dedup window (suppress same fingerprint within configurable period). This runs before any GitHub API call.
2. **GitHub label search**: Before creating a new issue, search for existing issues with the fingerprint label. If found and open, add a thumbs-up reaction. If found and closed, reopen with a recurrence comment.

**Consequences**:
- In-memory layer prevents API spam even if GitHub search is slow
- GitHub search catches duplicates across process restarts (in-memory state is lost)
- Thumbs-up reaction count serves as an occurrence counter
- Reopening closed issues surfaces regressions automatically

## Decision: Singleton pattern with fire-and-forget

**Context**: Error tracking must be globally accessible (any file can throw) and must never block the main application flow.

**Choice**: Module-level singleton initialized with `init()`. All GitHub API calls are fire-and-forget (pushed to a `pending[]` array). `flush()` resolves all pending promises for serverless environments.

**Consequences**:
- Simple API: `init()` once, `captureException()` anywhere
- `flush()` is critical in serverless — without it, the function exits before the API call completes
- In long-running servers, `flush()` is optional (calls complete in background)
- The `_reset()` function exists for testing (clear singleton between tests)

## Decision: GitHub client never throws

**Context**: The error tracker itself must never cause application errors. A failure in error reporting should be silent.

**Choice**: All methods in the GitHub API layer (`github.ts`) wrap their operations in try/catch and delegate to the configurable `onError` callback. They return `null` or `void` on failure.

**Consequences**:
- Application continues running even if GitHub API is down
- Errors in the tracker are logged via `onError` (default: `console.error`)
- No error propagation from the tracker to the host application

## Decision: Node.js only (no browser/edge)

**Context**: The package uses `node:crypto` for SHA-256 hashing and the GitHub token must never reach the browser.

**Choice**: The package is server-side only. Client-side error capture uses a proxy pattern: browser error boundaries POST to a server-side endpoint that calls `captureException()`.

**Consequences**:
- GitHub token security: never exposed to the browser
- Works in Node.js, Bun, and Deno (with node compat)
- Not compatible with Cloudflare Workers edge runtime (no `node:crypto`) without polyfill
- Browser integration requires a proxy endpoint (see examples)

## Decision: Rate limiter cleanup timer with unref()

**Context**: The rate limiter uses `setInterval` for periodic cleanup of expired entries. In serverless, this timer would keep the process alive indefinitely.

**Choice**: Call `timer.unref()` so the timer doesn't prevent Node.js process exit.

**Consequences**:
- Serverless functions exit normally after `flush()`
- Long-running servers still get periodic cleanup
- The `destroy()` method exists for explicit cleanup in tests

## Alternatives considered

1. **Keep Sentry** — comprehensive but adds SaaS cost and build complexity
2. **Log aggregation (LogFlare, Axiom)** — good for searching but doesn't create actionable issues
3. **Webhook to Slack/Discord** — simple alerts but no dedup, no tracking, no assignment
4. **GitHub Actions workflow** — could process error logs but adds latency and complexity
