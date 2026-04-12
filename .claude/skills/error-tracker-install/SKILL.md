---
name: error-tracker-install
description: Install and configure gh-issue-tracker in any project. Guides the user through architecture decisions (server-only vs client+server), security model, and framework-specific setup.
type: project
version: 1.1.0
triggers:
  - "install error tracker"
  - "add error tracking"
  - "setup github issues tracker"
  - "configure error reporting"
  - "add bug reporting"
  - "setup error monitoring"
---

# Error Tracker Installation Skill

Install and configure `gh-issue-tracker` — a lightweight error tracking package that creates GitHub Issues instead of sending to SaaS platforms.

## Quick Reference

```bash
npm install gh-issue-tracker   # or pnpm add / yarn add
```

Required env vars: `GITHUB_TOKEN`, `GITHUB_REPO`

## Prerequisites

1. **GitHub Fine-Grained Personal Access Token** with:
   - Repository access: target repository only
   - Permissions: Issues (read/write)
   - Generate at: GitHub → Settings → Developer settings → Fine-grained tokens
2. **Node.js >= 18** (uses `node:crypto`)

---

## Step 1: Determine the Architecture

**ASK THE USER** which errors they need to capture. This determines the architecture:

### Option A: Server-Only Errors

Best for: APIs, backend services, CLI tools, scripts, workers.

```
Server error → captureException() → GitHub Issues API
```

- `gh-issue-tracker` runs server-side only
- `GITHUB_TOKEN` stays in server environment
- Simplest setup: just `init()` + `captureException()`

### Option B: Server + Client Errors (Recommended for web apps)

Best for: Next.js, React, or any web app with a server component.

```
Browser error → POST to proxy endpoint → captureException() → GitHub Issues API
Server error  → captureException() directly → GitHub Issues API
```

- `gh-issue-tracker` still runs server-side only
- Browser errors are reported via a **proxy endpoint** (API route)
- `GITHUB_TOKEN` **NEVER** reaches the browser
- Error boundaries in React catch client-side errors and POST to the proxy

### Security Rule (NON-NEGOTIABLE)

**NEVER import `gh-issue-tracker` in client-side / browser code.** The package requires `GITHUB_TOKEN` which has write access to the repository. Exposing it in browser bundles would allow anyone to create/modify issues in your repo.

The proxy pattern solves this:
1. Error boundaries send error details (message, stack, URL) to YOUR API endpoint
2. Your API endpoint validates the request and calls `captureException()` server-side
3. The GitHub token never leaves the server

---

## Step 2: Install the package

```bash
npm install gh-issue-tracker
```

(Use the project's package manager: pnpm, yarn, or npm)

## Step 3: Set environment variables

Add to `.env` (or `.env.local` for Next.js):

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_REPO=myorg/myapp
```

Ensure `.env` is in `.gitignore`. For production, set these via your hosting platform (Vercel, Railway, etc.).

**For Option B (client + server)**, also set:

```env
ALLOWED_ORIGINS=https://myapp.com,https://staging.myapp.com
```

---

## Step 4: Framework-Specific Setup

### Next.js App Router

#### Server-side initialization (both Option A and B)

Create `instrumentation.ts` at project root:

```ts
import { init as initErrorTracker, captureException, flush } from 'gh-issue-tracker'

export async function register() {
  initErrorTracker({
    githubToken: process.env['GITHUB_TOKEN'] ?? '',
    githubRepo: process.env['GITHUB_REPO'] ?? '',
    environment: process.env['NODE_ENV'] ?? 'development',
    enabled: !!process.env['GITHUB_TOKEN'],
    labels: ['my-app'],
  })
}

export async function onRequestError(error: unknown) {
  if (error instanceof Error) {
    captureException(error, { tags: { source: 'onRequestError' } })
  } else {
    captureException(new Error(String(error)), { tags: { source: 'onRequestError' } })
  }
  await flush()
}
```

See `examples/nextjs-instrumentation/` for a complete file with inline comments.

#### Client error capture (Option B only)

**Step 4a: Create the proxy endpoint**

Create `app/api/errors/capture/route.ts` — this is the server-side endpoint that receives browser errors and forwards them to GitHub.

Copy from `examples/nextjs-error-proxy/route.ts`. Key security features:
- Origin allowlist (`ALLOWED_ORIGINS` env var)
- IP-based rate limiting (5 req/hour per IP)
- Zod schema validation
- 10KB body size cap
- Returns `200 OK` for invalid requests (doesn't leak validation logic)

**Step 4b: Create error boundaries**

Create `app/error.tsx` and `app/global-error.tsx` — these are React components that catch runtime errors in the browser and POST to the proxy.

Copy from `examples/nextjs-error-boundaries/`. These components:
- Catch errors via Next.js error boundary mechanism
- POST `{ message, stack, digest, url, boundary }` to `/api/errors/capture`
- Display a user-friendly error page with "Try again" button
- Fire-and-forget (`.catch(() => {})`) — error reporting failure doesn't affect UX

### Express / Node.js (Option A)

```ts
import { init, captureException, flush } from 'gh-issue-tracker'

// At app startup
init({
  githubToken: process.env['GITHUB_TOKEN']!,
  githubRepo: process.env['GITHUB_REPO']!,
  environment: process.env['NODE_ENV'] ?? 'development',
  labels: ['my-app'],
})

// Error handler middleware (MUST be after all routes)
app.use((err, req, res, next) => {
  captureException(err instanceof Error ? err : new Error(String(err)), {
    requestUrl: req.originalUrl,
    tags: { method: req.method },
  })
  flush().finally(() => res.status(500).json({ error: 'Internal server error' }))
})
```

See `examples/express-middleware/` for a complete example.

### Generic Node.js (Option A — scripts, workers, etc.)

```ts
import { init, captureException, flush } from 'gh-issue-tracker'

init({
  githubToken: process.env['GITHUB_TOKEN']!,
  githubRepo: process.env['GITHUB_REPO']!,
})

try {
  // your code
} catch (error) {
  captureException(error instanceof Error ? error : new Error(String(error)))
  await flush()
}
```

---

## Step 5: Verify

1. Start the application
2. Trigger a test error (server-side or client-side depending on your architecture)
3. Check the GitHub repository's Issues tab
4. Look for an issue with the `error-report` label
5. Trigger the same error again — verify it adds a thumbs-up reaction, not a duplicate issue

---

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `githubToken` | `string` | — | GitHub PAT with Issues permissions (required) |
| `githubRepo` | `string` | — | Repository in `owner/repo` format (required) |
| `environment` | `string` | `"development"` | Environment name shown in issue body |
| `labels` | `string[]` | `[]` | Additional labels on every issue |
| `enabled` | `boolean` | `true` | Kill switch to disable tracking |
| `onError` | `(err) => void` | `console.error` | Called when GitHub API fails |
| `rateLimitPerMinute` | `number` | `10` | Max new issues created per minute |
| `dedupeWindowMs` | `number` | `60000` | Suppress same fingerprint within this window |
| `reopenClosed` | `boolean` | `true` | Reopen closed issues on error recurrence |

## Security Checklist

- [ ] `GITHUB_TOKEN` is set only in server-side environment variables
- [ ] `GITHUB_TOKEN` is NOT in any client-side env (no `NEXT_PUBLIC_` prefix)
- [ ] `.env` files are in `.gitignore`
- [ ] `gh-issue-tracker` is NOT imported in any client component or browser code
- [ ] If using client error capture, the proxy endpoint has origin allowlist + rate limiting
- [ ] GitHub PAT uses fine-grained permissions (Issues only, single repo)

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| No issues created | Token missing or `enabled: false` | Check `GITHUB_TOKEN` is set |
| 403 from GitHub API | Token lacks permissions | Ensure Issues read/write on target repo |
| Duplicate issues | Different stack traces (line numbers changed) | The normalizer handles this — check if the error message itself varies |
| Rate limited | High error volume | Increase `rateLimitPerMinute` or fix the underlying errors |
| Token in browser bundle | Imported in client code | NEVER import in client — use the proxy pattern |
