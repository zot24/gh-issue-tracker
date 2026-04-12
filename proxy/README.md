# Deployable Error Proxies

Standalone error capture proxies that hold the `GITHUB_TOKEN` and accept error reports from browser error boundaries. Deploy one of these instead of adding an error capture route to every app.

## How it works

```
Browser error boundary
  → POST { message, stack, url, boundary }
  → Deployed proxy (holds GITHUB_TOKEN)
  → gh-issue-tracker → GitHub Issues API
```

Your frontend apps never see the GitHub token. They just POST error details to the proxy URL.

## Options

| Platform | Directory | Deployment |
|----------|-----------|------------|
| **Cloudflare Workers** | [`cloudflare-worker/`](cloudflare-worker/) | `wrangler deploy` |
| **Vercel Functions** | [`vercel-function/`](vercel-function/) | `vercel deploy` |

## When to use a proxy vs. an in-app route

**Use a standalone proxy when:**
- You have multiple frontend apps that all need error tracking
- You don't want to add API routes to your app
- You want a single deployment that serves all your projects

**Use an in-app route when:**
- You have one app and want everything self-contained
- You need custom rate limiting (e.g., Redis-backed)
- You want to enrich errors with server-side context (user sessions, etc.)

See [`examples/nextjs-error-proxy/`](../examples/nextjs-error-proxy/) for the in-app route approach.
