import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '@/http/ctx.ts'
import { TooManyRequests } from '@/http/errors.ts'

/** Attaches a request id, echoed on every error so logs and reports line up. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header('x-request-id')
  const id = incoming && incoming.length <= 64 ? incoming : crypto.randomUUID()
  c.set('requestId', id)
  c.header('x-request-id', id)
  await next()
})

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

/**
 * Fixed-window rate limit, FAIL OPEN.
 *
 * If the cache is unreachable the request proceeds: an outage in a protective
 * layer must not take the whole API down with it. The trade is that a cache
 * outage also removes the protection, which is the standard choice for an
 * internal tool and worth revisiting if this is ever exposed publicly.
 */
export function rateLimit(opts: {
  name: string
  limit: number
  windowSeconds: number
  /** Extra key material, e.g. the submitted email on a login attempt. */
  keyFrom?: (c: never) => string | undefined
}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const cache = c.get('cache')
    const extra = opts.keyFrom?.(c as never)
    const window = Math.floor(Date.now() / 1000 / opts.windowSeconds)
    const key = `rl:${opts.name}:${extra ?? clientIp(c)}:${window}`

    try {
      const hits = await cache.incr(key, opts.windowSeconds)
      if (hits > opts.limit) {
        c.header('retry-after', String(opts.windowSeconds))
        throw new TooManyRequests(
          `Too many attempts. Try again in ${opts.windowSeconds} seconds.`,
          opts.windowSeconds,
        )
      }
    } catch (err) {
      if (err instanceof TooManyRequests) throw err
      // Cache unreachable — let it through.
    }
    await next()
  })
}
