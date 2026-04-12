/**
 * Cloudflare Worker — Error capture proxy
 *
 * A standalone, deployable proxy that holds the GITHUB_TOKEN secret
 * and accepts error reports from browser error boundaries.
 *
 * Deploy this once, then point your error boundaries at the Worker URL.
 * No need to add error capture routes to your own app.
 *
 * Setup:
 *   1. npx wrangler init gh-error-proxy
 *   2. Copy this file as src/index.ts
 *   3. Copy wrangler.toml from this directory
 *   4. wrangler secret put GITHUB_TOKEN
 *   5. wrangler secret put GITHUB_REPO
 *   6. wrangler deploy
 *
 * Requires: nodejs_compat compatibility flag (for node:crypto)
 */

import { init, captureException, flush } from 'gh-issue-tracker'

interface Env {
  GITHUB_TOKEN: string
  GITHUB_REPO: string
  ALLOWED_ORIGINS: string // comma-separated
  ENVIRONMENT: string
}

// Rate limiting: simple in-memory map (resets on Worker restart)
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const ipHits = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = ipHits.get(ip)
  if (!entry || now >= entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true
  if (!origin) return false
  return allowed.some((a) => origin === a || origin.endsWith(`.${a}`))
}

// Minimal validation (no Zod dependency to keep the Worker lightweight)
function validatePayload(body: unknown): body is {
  message: string
  stack?: string
  digest?: string
  url: string
  boundary: string
} {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return (
    typeof b.message === 'string' &&
    b.message.length > 0 &&
    b.message.length <= 2000 &&
    typeof b.url === 'string' &&
    typeof b.boundary === 'string' &&
    (b.stack === undefined || (typeof b.stack === 'string' && b.stack.length <= 5000))
  )
}

let initialized = false

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only accept POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)

    // Origin check
    const origin = request.headers.get('origin')
    if (!isOriginAllowed(origin, allowedOrigins)) {
      return Response.json({ ok: true })
    }

    // Rate limit by IP
    const ip = request.headers.get('cf-connecting-ip') ?? '127.0.0.1'
    if (isRateLimited(ip)) {
      return Response.json({ error: 'Too many requests' }, {
        status: 429,
        headers: { 'Retry-After': '3600' },
      })
    }

    // Body size check (10KB)
    const contentLength = request.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024) {
      return Response.json({ ok: true })
    }

    // Parse body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ ok: true })
    }

    if (!validatePayload(body)) {
      return Response.json({ ok: true })
    }

    // Initialize tracker (once per Worker instance)
    if (!initialized) {
      init({
        githubToken: env.GITHUB_TOKEN,
        githubRepo: env.GITHUB_REPO,
        environment: env.ENVIRONMENT ?? 'production',
        enabled: !!env.GITHUB_TOKEN,
        labels: ['client-proxy'],
      })
      initialized = true
    }

    // Report error
    const error = new Error(body.message)
    if (body.stack) error.stack = body.stack

    captureException(error, {
      tags: {
        boundary: body.boundary,
        source: 'cloudflare-proxy',
        ...(body.digest && { digest: body.digest }),
      },
      extras: { url: body.url, digest: body.digest },
    })

    await flush()

    return Response.json({ ok: true }, {
      headers: origin ? {
        'Access-Control-Allow-Origin': origin,
      } : {},
    })
  },
}
