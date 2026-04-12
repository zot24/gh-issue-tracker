/**
 * Rate limiter with deduplication.
 *
 * Two layers of protection:
 * 1. Sliding window: max N issues created per minute
 * 2. Dedup window: suppress the same fingerprint within a configurable period
 */

export interface RateLimiterConfig {
  /** Max new issues per minute. */
  maxPerMinute: number
  /** Suppress duplicate fingerprints within this window (ms). */
  dedupeWindowMs: number
}

const ONE_MINUTE = 60_000
const CLEANUP_INTERVAL = 5 * 60_000 // 5 minutes

export class RateLimiter {
  private readonly config: RateLimiterConfig
  private readonly timestamps: number[] = []
  private readonly dedup = new Map<string, number>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: RateLimiterConfig) {
    this.config = config
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL)
    // Unref so the timer doesn't keep the process alive
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref()
    }
  }

  /**
   * Check whether a fingerprint can be processed right now.
   * Returns false if rate-limited or deduped.
   */
  canProcess(fingerprint: string): boolean {
    const now = Date.now()

    // Check dedup first
    const lastSeen = this.dedup.get(fingerprint)
    if (lastSeen !== undefined && now - lastSeen < this.config.dedupeWindowMs) {
      return false
    }

    // Check rate limit
    this.pruneOldTimestamps(now)
    return this.timestamps.length < this.config.maxPerMinute
  }

  /**
   * Record that a fingerprint was processed.
   * Call this after successfully processing (or starting to process) an error.
   */
  recordProcessed(fingerprint: string): void {
    const now = Date.now()
    this.timestamps.push(now)
    this.dedup.set(fingerprint, now)
  }

  /** Stop the cleanup timer. Call on shutdown. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private pruneOldTimestamps(now: number): void {
    const cutoff = now - ONE_MINUTE
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift()
    }
  }

  private cleanup(): void {
    const now = Date.now()
    this.pruneOldTimestamps(now)

    for (const [fp, ts] of this.dedup.entries()) {
      if (now - ts >= this.config.dedupeWindowMs) {
        this.dedup.delete(fp)
      }
    }
  }
}
