/**
 * Error fingerprinting.
 *
 * Produces a deterministic hash from an error's name, message (truncated),
 * and top stack frames. Two occurrences of the "same" error — even across
 * different deploys with different line numbers — should produce the same
 * fingerprint.
 *
 * Hashing uses the Web Crypto API (`crypto.subtle`), which is available on
 * every modern runtime — Node 20+, edge functions, Cloudflare Workers, Deno,
 * and browsers — so the tracker has no Node-only dependency and runs anywhere
 * `fetch` does. The algorithm is still SHA-256, so fingerprints are byte-for-byte
 * identical to the previous `node:crypto` implementation (existing issues keep
 * deduping correctly).
 */

import { extractFrames } from './normalizer'

const MESSAGE_TRUNCATE_LENGTH = 100

/**
 * Generate a 12-char hex fingerprint from an Error or plain string.
 */
export async function generateFingerprint(input: Error | string): Promise<string> {
  let name: string
  let message: string
  let stack: string | undefined

  if (typeof input === 'string') {
    name = 'Error'
    message = input
    stack = undefined
  } else {
    name = input.name || 'Error'
    message = input.message || ''
    stack = input.stack
  }

  const truncatedMessage = message.slice(0, MESSAGE_TRUNCATE_LENGTH)
  const frames = extractFrames(stack)
  const payload = `${name}\n${truncatedMessage}\n${frames.join('\n')}`

  const hash = await sha256Hex(payload)
  return hash.slice(0, 12)
}

/** SHA-256 of a string as lowercase hex, via the Web Crypto API. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)

  let hex = ''
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0')
  }
  return hex
}
