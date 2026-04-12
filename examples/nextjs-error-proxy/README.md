# Next.js Error Capture Proxy

Server-side proxy endpoint that receives errors from browser error boundaries and forwards them to GitHub Issues. This keeps the `GITHUB_TOKEN` server-side.

## Setup

1. Install `zod` if not already present: `npm install zod`
2. Copy `route.ts` to `app/api/errors/capture/route.ts` in your Next.js app.
3. Ensure `gh-issue-tracker` is initialized in your `instrumentation.ts` (see the `nextjs-instrumentation` example).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ALLOWED_ORIGINS` | No | Comma-separated list of allowed origins. Empty = allow all (dev mode). |

## How it works

1. Browser error boundaries POST `{ message, stack, digest, url, boundary }` to this endpoint.
2. The endpoint validates the payload with Zod, checks origin and rate limits.
3. It constructs an `Error` object and calls `captureException()` from `gh-issue-tracker`.
4. `flush()` ensures the GitHub API call completes before the serverless function returns.

## Rate Limiting

The example includes a simple in-memory rate limiter (5 requests/hour per IP). For production, replace it with a Redis-backed limiter (e.g., `@upstash/ratelimit`).

## Security

- GitHub token never reaches the browser
- Origin allowlist prevents cross-site abuse
- Zod schema rejects malformed payloads
- 10KB body cap prevents oversized requests
- Invalid requests return `200 OK` to avoid leaking validation logic
