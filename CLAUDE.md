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
├── github.ts         fetch-based GitHub REST client (search, create issue, add reaction, reopen). No SDK dep. Never throws.
├── fingerprint.ts    SHA-256 (Web Crypto) hash of error name + truncated message + normalized top 3 stack frames
├── normalizer.ts     Strips line:col numbers, webpack hashes, query strings from stack traces
├── rate-limiter.ts   Sliding window (N/min) + dedup window (fingerprint suppression)
└── __tests__/        40 unit tests (client, github, fingerprint, normalizer, rate-limiter)
```

### Key design decisions

- **Fingerprints as labels**: 12-char hex stored as GitHub label `fingerprint:<hash>`. Enables search.
- **Dedup strategy**: Search issues by fingerprint label. Open issue → add reaction. Closed → reopen + comment. Not found → create new.
- **Rate limiter unref**: Cleanup timer is `unref()`'d so it never prevents Node.js process exit.
- **GitHub client never throws**: All methods catch errors internally and call `onError`. The tracker never crashes the host application.
- **Runtime-agnostic, zero deps**: SHA-256 via Web Crypto (`crypto.subtle`) and a `fetch`-based GitHub client — no `node:crypto`, no SDK. Runs on Node 20+, edge functions, Cloudflare Workers, and Deno. Still server-side by design (the token must stay server-side), but "server-side" now includes edge runtimes. `generateFingerprint` is async because Web Crypto's `digest` is async — it runs inside the fire-and-forget promise, so the public `captureException`/`captureMessage` API still returns `void`.

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
pnpm test           # run all 40 tests with vitest
pnpm type-check     # tsc --noEmit
```

## Testing conventions

- Vitest with `globals: true`, `environment: 'node'`
- Mock the global `fetch` with `vi.stubGlobal('fetch', mockFetch)` (the GitHub client uses `fetch` directly)
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

The package needs the GitHub token, so it must run server-side (don't import it in client bundles), but it runs on any server runtime — Node 20+, edge, or Workers. To capture client-side (browser) errors, use one of two approaches:

**Direct mode**: Error boundaries POST to an API route in your app that calls `captureException()`. The token stays in your server environment. See `examples/nextjs-error-proxy/` and `examples/nextjs-error-boundaries/`.

**Proxy mode**: Deploy a standalone proxy (`proxy/cloudflare-worker/` or `proxy/vercel-function/`) that holds the token separately. Browser error boundaries POST directly to the proxy URL. Recommended for private repos or multi-app setups.

### Server-side errors

Call `captureException()` directly. In serverless, always `await flush()` before returning.

## File conventions

- All source in `src/`, tests in `src/__tests__/`
- Examples in `examples/` (not part of the npm package)
- ESM-first (`"type": "module"` in package.json)
- Build output in `dist/` (ESM + CJS + .d.ts)

## Deployable proxies

The `proxy/` directory contains standalone, deploy-once proxies for capturing client-side errors:

- `proxy/cloudflare-worker/` — Cloudflare Worker (no `nodejs_compat` needed — the package is edge-native via Web Crypto + `fetch`)
- `proxy/vercel-function/` — Vercel Serverless Function

These hold the `GITHUB_TOKEN` secret and accept POSTs from browser error boundaries. Users deploy one proxy and point all their apps at it — no need to add API routes to every app.

Both proxies include: origin allowlist, IP rate limiting, payload validation, CORS headers.
