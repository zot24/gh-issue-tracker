# Vercel Function Error Proxy

A standalone error capture proxy deployed as a Vercel Serverless Function. Holds the `GITHUB_TOKEN` secret so your frontend apps never need to.

## Why use this?

Instead of adding an error capture API route to every app, deploy this proxy **once** and point all your error boundaries at it. Vercel holds the GitHub token — your apps just POST error details.

## Deploy

```bash
# 1. Clone or copy this directory
# 2. Install dependencies
npm install

# 3. Set environment variables
vercel env add GITHUB_TOKEN    # paste your GitHub PAT
vercel env add GITHUB_REPO     # e.g., myorg/myapp

# 4. Deploy
vercel deploy --prod
```

## Environment Variables

Set these in the Vercel dashboard or via CLI:

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub PAT with Issues read/write |
| `GITHUB_REPO` | Yes | Target repo in `owner/repo` format |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed origins (empty = allow all) |
| `ENVIRONMENT` | No | Environment name in issues (default: `"production"`) |

## Use from error boundaries

Point your error boundaries at the deployed URL:

```ts
// In your error boundary (error.tsx)
fetch('https://your-proxy.vercel.app/api/capture', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: error.message,
    stack: error.stack,
    digest: error.digest,
    url: window.location.href,
    boundary: 'root',
  }),
}).catch(() => {})
```

## Security

- `GITHUB_TOKEN` is stored as a Vercel environment variable (encrypted, never in code)
- Origin allowlist prevents unauthorized domains from reporting errors
- IP-based rate limiting (5 req/hour per IP)
- Payload validation rejects malformed requests
- CORS headers included for cross-origin browser requests
