# gh-issue-tracker

Lightweight error tracking that creates GitHub Issues instead of sending to SaaS. Deduplication, fingerprinting, and rate limiting built-in.

## Why

- **Zero SaaS cost** — errors go directly to GitHub Issues
- **Deduplication built-in** — same error creates one issue, not N duplicates
- **Fingerprinting** — stable error identity across deploys (line number changes don't matter)
- **Rate limiting** — prevents GitHub API spam during error storms
- **Simple API** — `init()` once, `captureException()` anywhere

## How it works

```
Error thrown
  → Generate fingerprint (SHA-256 of name + message + top 3 normalized stack frames)
  → Check rate limiter (sliding window + dedup)
  → Search GitHub Issues by fingerprint label
    → Open issue found?   → Add thumbs-up reaction (count = frequency)
    → Closed issue found?  → Reopen + add comment
    → No issue found?      → Create new issue with error-report + fingerprint labels
```

## Quick start

```bash
npm install gh-issue-tracker
```

```ts
import { init, captureException, flush } from 'gh-issue-tracker'

init({
  githubToken: process.env.GITHUB_TOKEN!,
  githubRepo: 'myorg/myapp',
  environment: 'production',
})

try {
  riskyOperation()
} catch (error) {
  captureException(error instanceof Error ? error : new Error(String(error)))
  await flush() // wait for GitHub API call (important in serverless)
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `githubToken` | `string` | — | **Required.** GitHub PAT with Issues read/write permission |
| `githubRepo` | `string` | — | **Required.** Repository in `owner/repo` format |
| `environment` | `string` | `"development"` | Environment name shown in issue body |
| `labels` | `string[]` | `[]` | Additional labels applied to every issue |
| `enabled` | `boolean` | `true` | Kill switch to disable tracking |
| `onError` | `(err) => void` | `console.error` | Called when the GitHub API fails |
| `rateLimitPerMinute` | `number` | `10` | Max new issues created per minute |
| `dedupeWindowMs` | `number` | `60000` | Suppress same fingerprint within this window (ms) |
| `reopenClosed` | `boolean` | `true` | Reopen closed issues on error recurrence |

## API

### `init(config: ErrorTrackerConfig): void`

Initialize the error tracker. Call once at app startup. Must be called before `captureException` or `captureMessage`.

### `captureException(error: Error, context?: ErrorContext): void`

Capture an exception. Fire-and-forget — the GitHub API call happens in the background.

```ts
captureException(error, {
  tags: { component: 'auth', severity: 'critical' },
  extras: { userId: '123', action: 'login' },
  user: { id: '123', email: 'user@example.com' },
  requestUrl: '/api/login',
})
```

### `captureMessage(message: string, level?: 'error' | 'warning', context?: ErrorContext): void`

Capture a plain message as an error event.

```ts
captureMessage('Payment processing timeout', 'warning', {
  tags: { provider: 'stripe' },
})
```

### `flush(): Promise<void>`

Wait for all pending error reports to complete. **Always call before serverless functions return.**

```ts
captureException(error)
await flush() // don't return until the GitHub API call finishes
```

### `ErrorContext`

```ts
interface ErrorContext {
  tags?: Record<string, string>     // Key-value pairs shown in the issue
  extras?: Record<string, unknown>  // JSON metadata in a collapsible section
  user?: { id: string; email?: string }
  requestUrl?: string
  serverName?: string
}
```

## Framework guides

| Framework | Example | What it sets up |
|-----------|---------|----------------|
| **Next.js App Router** | [`examples/nextjs-instrumentation/`](examples/nextjs-instrumentation/) | Server-side `register()` + `onRequestError()` |
| **Next.js (client errors)** | [`examples/nextjs-error-proxy/`](examples/nextjs-error-proxy/) | Proxy endpoint for browser error boundaries |
| **Next.js (error UI)** | [`examples/nextjs-error-boundaries/`](examples/nextjs-error-boundaries/) | `error.tsx` and `global-error.tsx` components |
| **Express** | [`examples/express-middleware/`](examples/express-middleware/) | Error handler middleware |

### Full Next.js setup (recommended)

For complete Next.js coverage, combine all three Next.js examples:

1. **Server errors**: `instrumentation.ts` catches unhandled request errors
2. **Client errors**: Error boundaries catch React errors and POST to the proxy
3. **Proxy**: Server-side endpoint receives client errors and reports them (keeps token safe)

## GitHub token setup

1. Go to **GitHub → Settings → Developer settings → Fine-grained personal access tokens**
2. Click **Generate new token**
3. Set:
   - **Repository access**: Only select repositories → choose your target repo
   - **Permissions**: Issues → Read and write
4. Copy the token and set it as `GITHUB_TOKEN` in your environment

> For classic tokens, the `repo` scope works but grants broader access than needed.

## GitHub Issue structure

Issues created by the tracker look like this:

**Title**: `[Error] TypeError: Cannot read properties of undefined (reading 'map')`

**Labels**: `error-report`, `fingerprint:a1b2c3d4e5f6`, plus any custom labels

**Body**:
- Environment, fingerprint, and timestamp
- Error message
- Stack trace (code block)
- Tags, request URL, user info (if provided)
- Additional metadata (collapsible JSON)

## Architecture

### Fingerprinting

Errors are fingerprinted using SHA-256 of:
- Error name (e.g., `TypeError`)
- Message (first 100 characters)
- Top 3 normalized stack frames (line/column numbers, webpack hashes, and query strings stripped)

This produces a stable 12-character hex ID. The same logical error across different deploys produces the same fingerprint.

### Deduplication

Two layers:
1. **In-memory rate limiter**: Sliding window (max N new issues/min) + dedup window (suppress same fingerprint within 60s)
2. **GitHub search**: Before creating an issue, search for existing issues by `fingerprint:<hash>` label

### Rate limiting

- **Sliding window**: Max 10 new issues per minute (configurable)
- **Dedup window**: Same fingerprint suppressed for 60 seconds (configurable)
- Cleanup timer is `unref()`'d — never prevents Node.js process exit

## Limitations

- **Node.js only**: Uses `node:crypto` for fingerprinting. Not compatible with browser or edge runtimes.
- **No session replay**: Unlike Sentry, there's no UI recording for debugging.
- **No performance tracing**: No APM, transaction monitoring, or request timing.
- **GitHub API rate limits**: 5,000 requests/hour for authenticated tokens. The in-memory rate limiter prevents hitting this in practice.
- **Dynamic error messages**: Errors with timestamps or IDs in the message may create separate issues. Keep the first 100 characters stable.

## Requirements

- Node.js >= 18
- GitHub PAT with Issues read/write permission

## License

MIT
