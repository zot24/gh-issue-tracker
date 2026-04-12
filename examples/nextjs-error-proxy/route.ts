/**
 * POST /api/errors/capture
 *
 * Client-side error proxy endpoint. Error boundaries in the web app
 * POST here so errors can be reported to GitHub Issues without exposing
 * the GITHUB_TOKEN to the browser.
 *
 * Place this file at: app/api/errors/capture/route.ts
 *
 * Protection:
 * - No auth required (must work from unauthenticated error boundaries)
 * - IP-based rate limiting (5 req/hour per IP, in-memory)
 * - Origin header check against allowed domains
 * - Zod validation on payload
 * - 10KB body size cap
 */

import { NextRequest, NextResponse } from 'next/server'
import { captureException, flush } from 'gh-issue-tracker'
import { z } from 'zod'

const MAX_BODY_SIZE = 10 * 1024 // 10KB

const captureSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(5000).optional(),
  digest: z.string().max(100).optional(),
  url: z.string().url().max(2000),
  boundary: z.enum(['root', 'global']),
})

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function isOriginAllowed(origin: string | null): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true // dev mode
  if (!origin) return false
  return ALLOWED_ORIGINS.some((allowed) => origin === allowed || origin.endsWith(`.${allowed}`))
}

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter (replace with Redis/Upstash in production)
// ---------------------------------------------------------------------------

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

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '127.0.0.1'
  )
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Origin check
  const origin = request.headers.get('origin')
  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Rate limit by IP
  const ip = getClientIp(request)
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  // Body size check
  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Parse and validate
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const result = captureSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const { message, stack, digest, url, boundary } = result.data

  // Build an Error object and report it
  const error = new Error(message)
  if (stack) error.stack = stack

  captureException(error, {
    tags: {
      boundary,
      source: 'client-proxy',
      ...(digest && { digest }),
    },
    extras: { url, digest },
  })

  // Await pending GitHub API calls before the serverless function exits
  await flush()

  return NextResponse.json({ ok: true }, { status: 200 })
}
