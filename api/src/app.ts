import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { buildConfig, type Env } from '@/config/index.ts'
import { createCache } from '@/lib/cache.ts'
import { AppError, ValidationFailed } from '@/http/errors.ts'
import { fieldErrors } from '@/http/validate.ts'
import type { AppEnv } from '@/http/ctx.ts'
import { requestId } from '@/middleware/common.ts'
import { authRoutes } from '@/modules/auth/routes.ts'
import { directoryRoutes } from '@/modules/directory/routes.ts'
import { ticketRoutes } from '@/modules/tickets/routes.ts'
import { customerRoutes } from '@/modules/customers/routes.ts'
import { settingsRoutes } from '@/modules/settings/routes.ts'
import { reportRoutes } from '@/modules/reports/routes.ts'
import { emailRoutes } from '@/modules/email/routes.ts'

/**
 * The app. Both entry points build this same object, so Node and Workers run
 * byte-identical business logic and differ only in how they get a database.
 */
export function createApp(env: Env) {
  const app = new Hono<AppEnv>()
  const config = buildConfig(env)
  const cache = createCache(config)

  app.use('*', requestId)
  app.use('*', async (c, next) => {
    c.set('config', config)
    c.set('cache', cache)
    await next()
  })

  app.use(
    '/api/*',
    cors({
      origin: config.corsOrigins,
      // The refresh token travels as an httpOnly cookie, so the browser must be
      // allowed to send it.
      credentials: true,
      allowHeaders: ['content-type', 'authorization', 'x-request-id'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  )

  app.get('/health', (c) => c.json({ ok: true, env: config.appEnv }))

  const v1 = new Hono<AppEnv>()
  v1.route('/auth', authRoutes)
  v1.route('/', directoryRoutes)
  v1.route('/tickets', ticketRoutes)
  v1.route('/customers', customerRoutes)
  v1.route('/settings', settingsRoutes)
  v1.route('/reports', reportRoutes)
  app.route('/api/v1', v1)

  // Inbound mail. Not under /api/v1 and not behind requireAuth — the caller is
  // a mail server. Authenticated by shared secret inside the routes instead.
  app.route('/webhooks/email', emailRoutes)

  app.notFound((c) =>
    c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'No route matches that path' },
        requestId: c.get('requestId'),
      },
      404,
    ),
  )

  // The ONLY place a failure response is built. Services throw; this translates.
  app.onError((err, c) => {
    const rid = c.get('requestId')

    if (err instanceof AppError) {
      return c.json(
        {
          success: false as const,
          error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
          requestId: rid,
        },
        err.status as 400,
      )
    }

    // zValidator throws these; turn them into the same 422 shape as our own.
    if (err instanceof ZodError) {
      const v = new ValidationFailed(fieldErrors(err))
      return c.json(
        { success: false as const, error: { code: v.code, message: v.message, details: v.details }, requestId: rid },
        422,
      )
    }

    if (err instanceof HTTPException) {
      const cause = err.cause
      if (cause instanceof ZodError) {
        const v = new ValidationFailed(fieldErrors(cause))
        return c.json(
          { success: false as const, error: { code: v.code, message: v.message, details: v.details }, requestId: rid },
          422,
        )
      }
      return c.json(
        { success: false as const, error: { code: 'HTTP_ERROR', message: err.message }, requestId: rid },
        err.status,
      )
    }

    // A database that is down is the single most common local failure, and
    // "something went wrong" sends people hunting in the wrong place. Name it.
    // String(), not a cast: better-sqlite3 sets a string code like
    // SQLITE_ERROR, but D1 sets a NUMBER. Calling .startsWith on it threw
    // inside this very handler, which replaced every real error with a
    // generic 500 and hid the actual cause.
    const code = String((err as { code?: unknown })?.code ?? '')
    const message = String((err as Error)?.message ?? '')
    if (code.startsWith('SQLITE_') || /no such table|D1_ERROR/i.test(message)) {
      const where = config.db.file || 'the database'
      const detail = /no such table/i.test(message)
        ? `${where} has no schema yet. Run the migrations.`
        : `The database could not be read (${code || message}).`
      console.error(`[${rid}] database unavailable: ${code} — ${detail}`)
      return c.json(
        { success: false as const, error: { code: 'DATABASE_UNAVAILABLE', message: detail }, requestId: rid },
        503,
      )
    }

    // Unexpected: log with the request id, return nothing internal.
    console.error(`[${rid}] unhandled`, err)
    return c.json(
      {
        success: false as const,
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side' },
        requestId: rid,
      },
      500,
    )
  })

  return app
}
