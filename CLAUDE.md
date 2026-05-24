# gh-issue-tracker

Lightweight error tracking **and user bug reports** that create GitHub Issues. No SaaS dependency. Deduplication, fingerprinting, rate limiting, and screenshot capture built-in. Runtime-agnostic (Node 20+, edge, Workers, Deno) with zero required runtime dependencies.

## Setup guide (for consumers)

Everything below ships in the package by default — install once and wire the glue.

### 1. Install

```bash
npm install gh-issue-tracker
# Only if you want client-side screenshots (optional peer dep):
npm install modern-screenshot
```

### 2. Environment variables

```env
GITHUB_TOKEN=github_pat_xxx     # fine-grained PAT (scopes below)
GITHUB_REPO=owner/repo          # where issues are created
# Optional — required for screenshots on PRIVATE repos:
APP_BASE_URL=https://yourapp.com
```

**Token scopes (fine-grained PAT on the target repo):**
- **Issues: Read and write** — always required.
- **Contents: Read and write** — required ONLY for bug-report screenshots (they're committed to a `bug-report-screenshots` branch).

Without `GITHUB_TOKEN`, gate with `enabled: !!process.env.GITHUB_TOKEN` so local dev is a no-op.

### 3. Server: automatic error tracking

```ts
import { init, captureException, flush } from 'gh-issue-tracker'

init({
  githubToken: process.env.GITHUB_TOKEN!,
  githubRepo: process.env.GITHUB_REPO!,
  environment: process.env.NODE_ENV,
  enabled: !!process.env.GITHUB_TOKEN,
})

try { risky() } catch (e) {
  captureException(e instanceof Error ? e : new Error(String(e)))
  await flush() // wait before a serverless function returns
}
```

Framework wiring (Next.js `instrumentation.ts` + `onRequestError`, Express middleware) lives in [`examples/`](examples/). Note: `init()` reads config from its argument, not env, so call it once at startup. The package is edge-safe; if your routes use the edge runtime, see the edge note in the Next.js example.

#### Capture *every* 500 (thrown OR returned)

A server error must file an issue however it's produced. Frameworks surface two paths: a handler can **throw**, or it can deliberately **return** a 5xx (e.g. `return Response.json(..., { status: 500 })`). A thrown-error hook like `onRequestError` only sees the first. `withErrorReporting` wraps a handler and covers both:

```ts
import { withErrorReporting } from 'gh-issue-tracker'

// Reports any thrown error AND any returned status >= 500, then files an issue.
export const POST = withErrorReporting(async (req) => { ... })
```

Options: `minStatus` (default `500`), `catchThrows` (default `true`), `rethrow` (default `true` — capture then re-throw so the framework still handles it; set `false` to swallow and return a 500). Framework-agnostic (Next.js route handlers, Remix, Hono, Workers — anything `(Request) => Response`). Capture is deduplicated, so if a thrown error is *also* caught by `onRequestError`, only one issue is created. **The recipe: `onRequestError` for throws app-wide + `withErrorReporting` on any handler that can return a 5xx.**

### 4. Server: user bug reports with screenshots

`captureBugReport` creates a richly-formatted issue and (optionally) commits a screenshot, embedding it in the body. Unlike `captureException`, it awaits and returns the created issue.

```ts
// POST /api/bug-reports  (Node.js runtime — multipart form)
import { captureBugReport } from 'gh-issue-tracker'

const form = await request.formData()
const file = form.get('screenshot')
const result = await captureBugReport({
  message: String(form.get('message')),
  pageUrl: String(form.get('pageUrl')),
  reporter: { id: user.id, email: user.email, name: user.name, role: user.role },
  pin: /* { x, y } from form, optional */ undefined,
  metadata: { viewport: `${form.get('viewportWidth')} × ${form.get('viewportHeight')}`, userAgent: String(form.get('userAgent')) },
  screenshot: file instanceof File
    ? { data: new Uint8Array(await file.arrayBuffer()), filename: file.name }
    : undefined,
})
// → { issueNumber, issueUrl, screenshotUrl } | null
```

### 5. Server: screenshot proxy route (private repos)

Private-repo images can't be hot-linked, so serve them through `fetchIssueImage`:

```ts
// GET /api/bug-screenshots/[...path]  (Node.js runtime)
import { fetchIssueImage } from 'gh-issue-tracker'

const r = await fetchIssueImage({
  token: process.env.GITHUB_TOKEN!,
  repo: process.env.GITHUB_REPO!,
  path: params.path.join('/'),
})
if (r.status !== 200) return new Response(null, { status: r.status })
return new Response(r.body, {
  headers: { 'Content-Type': r.contentType!, 'Cache-Control': 'public, max-age=31536000, immutable' },
})
```

Set `appBaseUrl` in `init()` (and `screenshotProxyPath` if not the default `api/bug-screenshots`) so the embedded image URL points here.

### 6. Client: screenshot + submit helpers

Import from the `gh-issue-tracker/browser` subpath (keeps the server bundle dependency-free):

```ts
import { captureScreenshot, submitBugReport } from 'gh-issue-tracker/browser'

// Captures the page (incl. open modals); hides [data-bug-report]/[data-pin-overlay].
const shot = await captureScreenshot()

const res = await submitBugReport({
  endpoint: '/api/bug-reports',
  message,
  screenshot: shot?.file,
  pin,                       // optional { x, y } as % of viewport
  fetchInit: { credentials: 'include' },
})
// → { ok, status, issueNumber, issueUrl, error }
```

Build your own button/dialog UI around these (a pin-to-locate overlay is a nice touch). Mark a capture root with `data-screenshot-target` to scope the screenshot; otherwise it captures `document.body`.

## Architecture

**Singleton pattern**: call `init()` once at app startup, then `captureException()` / `captureMessage()` anywhere. All GitHub API calls are fire-and-forget. Call `flush()` before serverless functions return.

### Module graph

```
src/
├── index.ts          Server barrel (gh-issue-tracker): init, captureException, captureMessage, captureBugReport, withErrorReporting, flush, fetchIssueImage + types
├── browser.ts        Client barrel (gh-issue-tracker/browser): captureScreenshot, submitBugReport, buildBugReportFormData
├── types.ts          All TypeScript interfaces (config, ErrorContext, BugReport*, FetchIssueImage*)
├── client.ts         Singleton orchestrator — error dedup + captureBugReport (upload screenshot → create issue)
├── github.ts         fetch-based GitHub REST client (search/create issue, reaction, reopen, uploadImage). No SDK dep. Never throws.
├── bug-report.ts     Pure helpers: base64 encode, screenshot path, issue body formatting
├── screenshot.ts     fetchIssueImage — read-through proxy for private-repo screenshots
├── handler.ts        withErrorReporting — wrap a route handler to capture thrown errors + returned 5xx
├── fingerprint.ts    SHA-256 (Web Crypto) hash of error name + truncated message + normalized top 3 stack frames
├── normalizer.ts     Strips line:col numbers, webpack hashes, query strings from stack traces
├── rate-limiter.ts   Sliding window (N/min) + dedup window (fingerprint suppression)
└── __tests__/        61 unit tests (client, github, fingerprint, normalizer, rate-limiter, screenshot, handler)
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
pnpm test           # run all 61 tests with vitest
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
