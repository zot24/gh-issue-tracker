import { describe, it, expect, vi, beforeEach } from 'vitest'

// The wrapper reports via the client singleton — mock it.
vi.mock('../client', () => ({
  captureException: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
}))

import { captureException, flush } from '../client'
import { withErrorReporting } from '../handler'

function req(method = 'POST', url = 'https://app.test/api/thing') {
  return { method, url } as unknown as Request
}

describe('withErrorReporting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes through a successful response without reporting', async () => {
    const handler = withErrorReporting(async () => new Response('ok', { status: 200 }))
    const res = await handler(req())
    expect(res.status).toBe(200)
    expect(captureException).not.toHaveBeenCalled()
  })

  it('reports a returned 5xx response and still returns it', async () => {
    const handler = withErrorReporting(async () =>
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    )
    const res = await handler(req('POST', 'https://app.test/api/x'))

    expect(res.status).toBe(500)
    expect(captureException).toHaveBeenCalledOnce()
    const [err, ctx] = vi.mocked(captureException).mock.calls[0]
    expect((err as Error).message).toContain('HTTP 500 from POST https://app.test/api/x')
    expect((err as Error).message).toContain('boom') // body snippet included
    expect(ctx).toMatchObject({
      tags: { source: 'withErrorReporting', kind: 'response', status: '500', method: 'POST' },
      requestUrl: 'https://app.test/api/x',
    })
    expect(flush).toHaveBeenCalled()
  })

  it('does not report 4xx by default', async () => {
    const handler = withErrorReporting(async () => new Response('bad', { status: 400 }))
    await handler(req())
    expect(captureException).not.toHaveBeenCalled()
  })

  it('honors a custom minStatus (e.g. capture 429+)', async () => {
    const handler = withErrorReporting(async () => new Response('slow', { status: 429 }), {
      minStatus: 429,
    })
    await handler(req())
    expect(captureException).toHaveBeenCalledOnce()
  })

  it('captures a thrown error and re-throws by default', async () => {
    const boom = new Error('kaboom')
    const handler = withErrorReporting(async () => {
      throw boom
    })
    await expect(handler(req('GET'))).rejects.toThrow('kaboom')
    expect(captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ tags: expect.objectContaining({ kind: 'throw', method: 'GET' }) }),
    )
  })

  it('swallows a thrown error and returns 500 when rethrow:false', async () => {
    const handler = withErrorReporting(
      async () => {
        throw new Error('kaboom')
      },
      { rethrow: false },
    )
    const res = await handler(req())
    expect(res.status).toBe(500)
    expect(captureException).toHaveBeenCalledOnce()
  })

  it('does not capture throws when catchThrows:false (still re-throws)', async () => {
    const handler = withErrorReporting(
      async () => {
        throw new Error('kaboom')
      },
      { catchThrows: false },
    )
    await expect(handler(req())).rejects.toThrow('kaboom')
    expect(captureException).not.toHaveBeenCalled()
  })

  it('wraps non-Error throws', async () => {
    const handler = withErrorReporting(async () => {
      throw 'string failure'
    })
    await expect(handler(req())).rejects.toBeDefined()
    const [err] = vi.mocked(captureException).mock.calls[0]
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('string failure')
  })

  it('forwards all handler args (params, etc.)', async () => {
    const handler = withErrorReporting(
      async (_r: Request, ctx: { id: string }) => new Response(ctx.id, { status: 200 }),
    )
    const res = await handler(req(), { id: 'abc' })
    expect(await res.text()).toBe('abc')
  })
})
