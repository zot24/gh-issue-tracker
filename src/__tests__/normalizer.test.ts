import { describe, it, expect } from 'vitest'
import { normalizeStack, extractFrames } from '../normalizer'

describe('normalizeStack', () => {
  it('strips line and column numbers', () => {
    const stack = `Error: boom
    at getUser (/app/src/lib/auth.ts:42:13)
    at handler (/app/src/api/route.ts:15:20)`

    const normalized = normalizeStack(stack)
    expect(normalized).not.toContain(':42:13')
    expect(normalized).not.toContain(':15:20')
    expect(normalized).toContain('/app/src/lib/auth.ts')
    expect(normalized).toContain('/app/src/api/route.ts')
  })

  it('strips webpack/turbopack chunk hashes', () => {
    const stack = `Error: fail
    at Module.getUser (webpack-internal:///./src/lib/auth.ts?abc123:42:13)
    at handler (webpack-internal:///./src/api/route.ts?def456:15:20)`

    const normalized = normalizeStack(stack)
    expect(normalized).not.toContain('?abc123')
    expect(normalized).not.toContain('?def456')
    expect(normalized).not.toContain('webpack-internal:///')
  })

  it('strips query strings from file paths', () => {
    const stack = `Error: oops
    at fn (/app/src/lib/util.ts?v=abc123:10:5)`

    const normalized = normalizeStack(stack)
    expect(normalized).not.toContain('?v=abc123')
  })

  it('returns empty string for undefined/null stack', () => {
    expect(normalizeStack(undefined)).toBe('')
    expect(normalizeStack('')).toBe('')
  })
})

describe('extractFrames', () => {
  it('returns first 3 meaningful frames, skipping node_modules', () => {
    const stack = `Error: boom
    at getUser (/app/src/lib/auth.ts:42:13)
    at Object.<anonymous> (/app/node_modules/express/lib/router.js:100:5)
    at handler (/app/src/api/route.ts:15:20)
    at middleware (/app/src/middleware.ts:8:3)
    at deepFn (/app/src/lib/deep.ts:99:1)`

    const frames = extractFrames(stack)
    expect(frames).toHaveLength(3)
    expect(frames[0]).toContain('auth.ts')
    expect(frames[1]).toContain('route.ts')
    expect(frames[2]).toContain('middleware.ts')
    // node_modules frame should be skipped
    expect(frames.join('')).not.toContain('node_modules')
  })

  it('returns fewer than 3 frames if stack is short', () => {
    const stack = `Error: small
    at fn (/app/src/index.ts:1:1)`

    const frames = extractFrames(stack)
    expect(frames).toHaveLength(1)
  })

  it('returns empty array for missing stack', () => {
    expect(extractFrames(undefined)).toEqual([])
    expect(extractFrames('')).toEqual([])
  })
})
