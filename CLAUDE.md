# gh-issue-tracker

Lightweight error tracking that creates GitHub Issues. No SaaS dependency. Deduplication, fingerprinting, and rate limiting built-in.

## Architecture

**Singleton pattern**: call `init()` once at app startup, then `captureException()` / `captureMessage()` anywhere. All GitHub API calls are fire-and-forget. Call `flush()` before serverless functions return.

### Module graph

```
src/
├── index.ts          Public barrel: init, captureException, captureMessage, flush + types
├── types.ts          All TypeScript interfaces (ErrorTrackerConfig, ErrorContext, etc.)
├── client.ts         Singleton orchestrator — manages pending promises, coordinates dedup + GitHub
├── github.ts         Octokit wrapper (search, create issue, add reaction, reopen). Never throws.
├── fingerprint.ts    SHA-256 hash of error name + truncated message + normalized top 3 stack frames
├── normalizer.ts     Strips line:col numbers, webpack hashes, query strings from stack traces
├── rate-limiter.ts   Sliding window (N/min) + dedup window (fingerprint suppression)
└── __tests__/        38 unit tests (client, github, fingerprint, normalizer, rate-limiter)
```

### Key design decisions

- **Fingerprints as labels**: 12-char hex stored as GitHub label `fingerprint:<hash>`. Enables search.
- **Dedup strategy**: Search issues by fingerprint label. Open issue → add reaction. Closed → reopen + comment. Not found → create new.
- **Rate limiter unref**: Cleanup timer is `unref()`'d so it never prevents Node.js process exit.
- **GitHub client never throws**: All methods catch errors internally and call `onError`. The tracker never crashes the host application.
- **Node.js only**: Uses `node:crypto` for SHA-256. Not compatible with browser/edge runtimes (by design — the GitHub token must stay server-side).

### Error flow

```
Error thrown → captureException(error, context?)
  → generateFingerprint(error)          [fingerprint.ts]
  → rateLimiter.canProcess(fingerprint)  [rate-limiter.ts]
  → github.searchExistingIssue(fp)       [github.ts]
    → existing & open?  → addReaction()
    → existing & closed? → reopenIssue() + addReaction()
    → not found?         → createIssue(title, body, labels)
  → promise added to pending[]
  → flush() resolves all pending promises
```

## Development

```bash
pnpm install        # install dependencies
pnpm build          # build ESM + CJS + .d.ts via tsup
pnpm test           # run all 38 tests with vitest
pnpm type-check     # tsc --noEmit
```

## Testing conventions

- Vitest with `globals: true`, `environment: 'node'`
- Mock `octokit` at module level with `vi.mock('octokit', ...)`
- Use `_reset()` (internal export) between tests to clear singleton state
- Use `vi.useFakeTimers()` for rate-limiter time-dependent tests
- Tests are co-located in `src/__tests__/`

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub PAT with Issues read/write on target repo |
| `GITHUB_REPO` | Yes | Target repository in `owner/repo` format |

## Integration patterns

See `examples/` for framework-specific integration:

- `examples/nextjs-instrumentation/` — Next.js `register()` + `onRequestError()`
- `examples/nextjs-error-proxy/` — Server-side proxy endpoint for browser errors
- `examples/nextjs-error-boundaries/` — React error boundaries that POST to the proxy
- `examples/express-middleware/` — Express error handler middleware

### Client-side errors (browser)

The GitHub token must **never** reach the browser. Use the proxy pattern:
1. Error boundaries POST to a server-side endpoint (e.g., `/api/errors/capture`)
2. The endpoint calls `captureException()` + `flush()` server-side
3. See `examples/nextjs-error-proxy/` and `examples/nextjs-error-boundaries/`

### Server-side errors

Call `captureException()` directly. In serverless, always `await flush()` before returning.

## File conventions

- All source in `src/`, tests in `src/__tests__/`
- Examples in `examples/` (not part of the npm package)
- ESM-first (`"type": "module"` in package.json)
- Build output in `dist/` (ESM + CJS + .d.ts)
