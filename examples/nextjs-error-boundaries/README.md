# Next.js Error Boundaries

React error boundary components that catch runtime errors and report them to the server-side error tracker via the proxy endpoint.

## Files

| File | Placement | Purpose |
|------|-----------|---------|
| `error.tsx` | `app/error.tsx` | Catches errors in route segments |
| `global-error.tsx` | `app/global-error.tsx` | Catches errors in the root layout |

## Setup

1. Copy the files to their respective locations in your `app/` directory.
2. Ensure the error capture proxy is set up (see `nextjs-error-proxy` example).

## How it works

Both components are React Client Components (`'use client'`) that:

1. Catch errors via Next.js error boundary mechanism
2. POST error details to `/api/errors/capture` (fire-and-forget)
3. Display a user-friendly error page with:
   - Error message
   - Error ID (digest) for support reference
   - "Try again" button to attempt recovery
   - "Go home" link (root boundary only)

## Customization

- Update the proxy URL if you placed the error capture route at a different path
- Customize the error UI to match your app's design system
- Add additional error context (user ID, page state) to the POST body
