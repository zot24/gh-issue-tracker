# Next.js Instrumentation Example

Server-side error tracking for Next.js apps using the [instrumentation hook](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).

## Setup

1. Copy `instrumentation.ts` to your project root (next to `package.json`).
2. Set environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub PAT with Issues read/write permission |
| `GITHUB_REPO` | Yes | Target repository, e.g. `myorg/myapp` |
| `APP_ENV` | No | Environment name (defaults to `"development"`) |

3. Update the `labels` array to match your app name.

## How it works

- `register()` is called once when Next.js starts. It initializes the error tracker singleton.
- `onRequestError()` is called for every unhandled request error. It captures the error and waits for the GitHub API call to complete before the function returns (important for serverless environments).

## Notes

- The tracker is disabled when `GITHUB_TOKEN` is not set, so local development works without configuration.
- For Vercel deployments, use `VERCEL_ENV` instead of `APP_ENV` if preferred.
