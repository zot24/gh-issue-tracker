/**
 * Vercel Serverless Function — Error capture proxy
 *
 * A standalone, deployable proxy that holds the GITHUB_TOKEN secret
 * and accepts error reports from browser error boundaries.
 *
 * Deploy this once, then point your error boundaries at the function URL.
 *
 * Setup:
 *   1. Create a new directory, copy this file structure
 *   2. npm install gh-issue-tracker
 *   3. vercel env add GITHUB_TOKEN
 *   4. vercel env add GITHUB_REPO
 *   5. vercel deploy
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { init, captureException, flush } from 'gh-issue-tracker'

// Rate limiting: simple in-memory map (resets on cold start)
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

function isOriginAllowed(origin: string | null): boolean {
  const allowed = (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (allowed.length === 0) return true
  if (!origin) return false
  return allowed.some((a) => origin === a || origin.endsWith(`.${a}`))
}

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

function ensureInit() {
  if (initialized) return
  init({
    githubToken: process.env['GITHUB_TOKEN'] ?? '',
    githubRepo: process.env['GITHUB_REPO'] ?? '',
    environment: process.env['ENVIRONMENT'] ?? 'production',
    enabled: !!process.env['GITHUB_TOKEN'],
    labels: ['client-proxy'],
  })
  initialized = true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  const origin = req.headers.origin as string | undefined
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Origin check
  if (!isOriginAllowed(origin ?? null)) {
    return res.status(200).json({ ok: true })
  }

  // Rate limit by IP
  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
      : req.headers['x-real-ip'] as string) ?? '127.0.0.1'

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests' })
  }

  // Validate payload
  const body = req.body
  if (!validatePayload(body)) {
    return res.status(200).json({ ok: true })
  }

  // Init and report
  ensureInit()

  const error = new Error(body.message)
  if (body.stack) error.stack = body.stack

  captureException(error, {
    tags: {
      boundary: body.boundary,
      source: 'vercel-proxy',
      ...(body.digest && { digest: body.digest }),
    },
    extras: { url: body.url, digest: body.digest },
  })

  await flush()

  return res.status(200).json({ ok: true })
}
