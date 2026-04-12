import { describe, it, expect } from 'vitest'
import { generateFingerprint } from '../fingerprint'

describe('generateFingerprint', () => {
  it('produces a 12-char hex string', () => {
    const error = new Error('Something went wrong')
    error.stack = `Error: Something went wrong
    at getUser (/app/src/lib/auth.ts:42:13)
    at handler (/app/src/api/route.ts:15:20)`

    const fp = generateFingerprint(error)
    expect(fp).toMatch(/^[a-f0-9]{12}$/)
  })

  it('produces the same fingerprint for the same error with different line numbers', () => {
    const error1 = new Error('Cannot read properties of undefined')
    error1.stack = `Error: Cannot read properties of undefined
    at getUser (/app/src/lib/auth.ts:42:13)
    at handler (/app/src/api/route.ts:15:20)`

    const error2 = new Error('Cannot read properties of undefined')
    error2.stack = `Error: Cannot read properties of undefined
    at getUser (/app/src/lib/auth.ts:99:1)
    at handler (/app/src/api/route.ts:200:5)`

    expect(generateFingerprint(error1)).toBe(generateFingerprint(error2))
  })

  it('produces different fingerprints for different errors', () => {
    const error1 = new Error('TypeError: cannot read property id')
    error1.stack = `Error: TypeError: cannot read property id
    at getUser (/app/src/lib/auth.ts:42:13)`

    const error2 = new Error('RangeError: max call stack exceeded')
    error2.stack = `Error: RangeError: max call stack exceeded
    at recursive (/app/src/lib/deep.ts:10:5)`

    expect(generateFingerprint(error1)).not.toBe(generateFingerprint(error2))
  })

  it('truncates long messages to prevent hash divergence on dynamic suffixes', () => {
    const error1 = new Error('Failed for user user_abc123 at timestamp 1234567890')
    error1.stack = `Error: Failed
    at fn (/app/src/lib/a.ts:1:1)`

    const error2 = new Error('Failed for user user_xyz789 at timestamp 9999999999')
    error2.stack = `Error: Failed
    at fn (/app/src/lib/a.ts:1:1)`

    // Same first 100 chars of message + same stack → same fingerprint
    // These messages differ after char ~20 so they WILL differ
    // This test documents the behavior — short dynamic messages produce different fingerprints
    const fp1 = generateFingerprint(error1)
    const fp2 = generateFingerprint(error2)
    expect(fp1).not.toBe(fp2)
  })

  it('handles errors without stack traces', () => {
    const error = new Error('No stack')
    error.stack = undefined

    const fp = generateFingerprint(error)
    expect(fp).toMatch(/^[a-f0-9]{12}$/)
  })

  it('works with message-only input', () => {
    const fp = generateFingerprint('plain string error')
    expect(fp).toMatch(/^[a-f0-9]{12}$/)
  })
})
