import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RateLimiter } from '../rate-limiter'

describe('RateLimiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    limiter = new RateLimiter({ maxPerMinute: 3, dedupeWindowMs: 5_000 })
  })

  afterEach(() => {
    limiter.destroy()
    vi.useRealTimers()
  })

  describe('rate limiting', () => {
    it('allows requests under the limit', () => {
      expect(limiter.canProcess('fp-1')).toBe(true)
      limiter.recordProcessed('fp-1')
      expect(limiter.canProcess('fp-2')).toBe(true)
      limiter.recordProcessed('fp-2')
      expect(limiter.canProcess('fp-3')).toBe(true)
    })

    it('blocks requests over the limit', () => {
      limiter.recordProcessed('fp-1')
      limiter.recordProcessed('fp-2')
      limiter.recordProcessed('fp-3')

      expect(limiter.canProcess('fp-4')).toBe(false)
    })

    it('allows requests again after the window expires', () => {
      limiter.recordProcessed('fp-1')
      limiter.recordProcessed('fp-2')
      limiter.recordProcessed('fp-3')

      expect(limiter.canProcess('fp-4')).toBe(false)

      // Advance past the 1-minute window
      vi.advanceTimersByTime(61_000)

      expect(limiter.canProcess('fp-4')).toBe(true)
    })
  })

  describe('deduplication', () => {
    it('blocks the same fingerprint within the dedup window', () => {
      limiter.recordProcessed('fp-same')
      expect(limiter.canProcess('fp-same')).toBe(false)
    })

    it('allows the same fingerprint after the dedup window expires', () => {
      limiter.recordProcessed('fp-same')
      expect(limiter.canProcess('fp-same')).toBe(false)

      vi.advanceTimersByTime(6_000) // past 5s dedup window

      expect(limiter.canProcess('fp-same')).toBe(true)
    })

    it('does not count dedup blocks against the rate limit', () => {
      limiter.recordProcessed('fp-1')
      // fp-1 is deduped but should not consume rate limit slots
      expect(limiter.canProcess('fp-1')).toBe(false)
      expect(limiter.canProcess('fp-2')).toBe(true)
      limiter.recordProcessed('fp-2')
      expect(limiter.canProcess('fp-3')).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('cleans up expired entries', () => {
      limiter.recordProcessed('fp-old')

      // Advance past both windows
      vi.advanceTimersByTime(120_000)

      // After cleanup, the old entry should be gone
      expect(limiter.canProcess('fp-old')).toBe(true)
    })
  })
})
