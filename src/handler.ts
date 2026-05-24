/**
 * Route-handler wrapper — capture every server error a handler produces.
 *
 * Frameworks surface server errors two ways: a handler can THROW, or it can
 * deliberately RETURN a 5xx response. A thrown-error hook (e.g. Next.js
 * `onRequestError`) only sees the first. `withErrorReporting` covers both, so
 * "a 500 is a server error → it files an issue" holds no matter how the 500 is
 * produced.
 *
 * Framework-agnostic: works with anything whose handler takes a Web `Request`
 * first and returns a `Response` (Next.js route handlers, Remix, Hono,
 * Cloudflare Workers, plain fetch handlers). Edge-native, zero deps.
 *
 *   export const POST = withErrorReporting(async (req) => { ... })
 *
 * Requires `init()` to have run. Capture is deduplicated, so even if a thrown
 * error is ALSO reported by a framework hook, only one issue is created.
 */

import type { ErrorContext } from './types'
import { captureException, flush } from './client'

export interface WithErrorReportingOptions {
  /** Report responses whose status is >= this. Default: 500. */
  minStatus?: number
  /** Also capture thrown errors (not just returned 5xx). Default: true. */
  catchThrows?: boolean
  /**
   * Re-throw a caught error after reporting it (so the framework still handles
   * it). Default: true. When false, the error is swallowed and a 500 response
   * is returned instead.
   */
  rethrow?: boolean
  /** Extra context merged into every report (tags, user, etc.). */
  context?: ErrorContext
}

function requestInfo(arg: unknown): { method?: string; url?: string } {
  const r = arg as { method?: unknown; url?: unknown } | undefined
  return {
    method: typeof r?.method === 'string' ? r.method : undefined,
    url: typeof r?.url === 'string' ? r.url : undefined,
  }
}

function mergeContext(
  base: ErrorContext | undefined,
  extraTags: Record<string, string>,
  url: string | undefined,
): ErrorContext {
  return {
    ...base,
    tags: { ...extraTags, ...(base?.tags ?? {}) },
    requestUrl: base?.requestUrl ?? url,
  }
}

export function withErrorReporting<A extends unknown[]>(
  handler: (...args: A) => Response | Promise<Response>,
  options: WithErrorReportingOptions = {},
): (...args: A) => Promise<Response> {
  const minStatus = options.minStatus ?? 500
  const catchThrows = options.catchThrows ?? true
  const rethrow = options.rethrow ?? true

  return async (...args: A): Promise<Response> => {
    let res: Response
    try {
      res = await handler(...args)
    } catch (err) {
      if (catchThrows) {
        const { method, url } = requestInfo(args[0])
        captureException(err instanceof Error ? err : new Error(String(err)), {
          ...mergeContext(
            options.context,
            { source: 'withErrorReporting', kind: 'throw', ...(method ? { method } : {}) },
            url,
          ),
        })
        await flush()
        if (!rethrow) {
          return new Response('Internal Server Error', { status: 500 })
        }
      }
      throw err
    }

    if (res.status >= minStatus) {
      const { method, url } = requestInfo(args[0])
      let detail = ''
      try {
        detail = (await res.clone().text()).slice(0, 300)
      } catch {
        /* body not readable — ignore */
      }
      captureException(
        new Error(
          `HTTP ${res.status} from ${method ?? '?'} ${url ?? '?'}${detail ? ` — ${detail}` : ''}`,
        ),
        mergeContext(
          options.context,
          {
            source: 'withErrorReporting',
            kind: 'response',
            status: String(res.status),
            ...(method ? { method } : {}),
          },
          url,
        ),
      )
      await flush()
    }

    return res
  }
}
