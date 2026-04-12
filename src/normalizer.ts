/**
 * Stack trace normalizer.
 *
 * Strips volatile parts of stack traces (line/column numbers, webpack hashes,
 * query strings) so that the same logical error produces the same fingerprint
 * across deploys.
 */

/** Strip line:col numbers like `:42:13` at the end of file paths */
const LINE_COL_RE = /:\d+:\d+/g

/** Strip webpack-internal:/// prefix */
const WEBPACK_PREFIX_RE = /webpack-internal:\/\/\//g

/** Strip query strings from file paths like `?abc123` or `?v=hash` */
const QUERY_STRING_RE = /\?[^\s)]+/g

/** Match stack frame lines (starts with "at " after whitespace) */
const FRAME_RE = /^\s+at\s+/

/** Skip frames from node_modules */
const NODE_MODULES_RE = /node_modules/

/**
 * Normalize a stack trace by removing volatile parts.
 * Returns a stable string suitable for hashing.
 */
export function normalizeStack(stack: string | undefined): string {
  if (!stack) return ''

  return stack
    .replace(WEBPACK_PREFIX_RE, '')
    .replace(QUERY_STRING_RE, '')
    .replace(LINE_COL_RE, '')
}

/**
 * Extract the first N meaningful (non-node_modules) frames from a stack trace.
 * Used for fingerprint generation — only top frames matter for identity.
 */
export function extractFrames(stack: string | undefined, maxFrames = 3): string[] {
  if (!stack) return []

  const lines = stack.split('\n')
  const frames: string[] = []

  for (const line of lines) {
    if (!FRAME_RE.test(line)) continue
    if (NODE_MODULES_RE.test(line)) continue

    // Normalize the frame before collecting
    const normalized = line
      .replace(WEBPACK_PREFIX_RE, '')
      .replace(QUERY_STRING_RE, '')
      .replace(LINE_COL_RE, '')
      .trim()

    frames.push(normalized)
    if (frames.length >= maxFrames) break
  }

  return frames
}
