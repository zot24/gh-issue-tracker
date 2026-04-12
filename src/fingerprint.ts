/**
 * Error fingerprinting.
 *
 * Produces a deterministic hash from an error's name, message (truncated),
 * and top stack frames. Two occurrences of the "same" error — even across
 * different deploys with different line numbers — should produce the same
 * fingerprint.
 */

import { createHash } from 'node:crypto'
import { extractFrames } from './normalizer'

const MESSAGE_TRUNCATE_LENGTH = 100

/**
 * Generate a 12-char hex fingerprint from an Error or plain string.
 */
export function generateFingerprint(input: Error | string): string {
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

  const hash = createHash('sha256').update(payload).digest('hex')
  return hash.slice(0, 12)
}
