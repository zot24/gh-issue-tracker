# Cloudflare Worker Error Proxy

A standalone error capture proxy deployed as a Cloudflare Worker. Holds the `GITHUB_TOKEN` secret so your frontend apps never need to.

## Why use this?

Instead of adding an error capture API route to every app, deploy this proxy **once** and point all your error boundaries at it. The Worker holds the GitHub token — your apps just POST error details.

## Deploy

```bash
# 1. Install Wrangler
npm install -g wrangler

# 2. Set secrets
wrangler secret put GITHUB_TOKEN    # paste your GitHub PAT
wrangler secret put GITHUB_REPO     # e.g., myorg/myapp

# 3. Deploy
wrangler deploy
```

## Configure

Edit `wrangler.toml`:

| Variable | Description |
|----------|-------------|
| `ALLOWED_ORIGINS` | Comma-separated allowed origins (empty = allow all) |
| `ENVIRONMENT` | Environment name shown in issues (default: `"production"`) |

## Use from error boundaries

Point your error boundaries at the Worker URL:

```ts
// In your error boundary (error.tsx)
fetch('https://gh-error-proxy.YOUR-SUBDOMAIN.workers.dev', {
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

## Requirements

- Cloudflare account (free tier works)
- `nodejs_compat` compatibility flag (enabled in wrangler.toml)
- `gh-issue-tracker` package (bundled into the Worker)

## Security

- `GITHUB_TOKEN` is stored as a Cloudflare secret (encrypted at rest, never in code)
- Origin allowlist prevents unauthorized domains from reporting errors
- IP-based rate limiting (5 req/hour per IP)
- 10KB body cap prevents abuse
- CORS headers included for cross-origin browser requests
