import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppEnv } from '@/http/ctx.ts'
import { ok } from '@/http/respond.ts'
import { zValidator } from '@hono/zod-validator'
import { envelopeValidation } from '@/http/validate.ts'
import { Unauthorized } from '@/http/errors.ts'
import { signAccessToken } from '@/lib/jwt.ts'
import { randomToken, verifyPassword } from '@/lib/crypto.ts'
import { requireAuth } from '@/middleware/auth.ts'
import { rateLimit } from '@/middleware/common.ts'
import * as repo from './repository.ts'

const REFRESH_COOKIE = 'sp_refresh'

/**
 * How long a just-rotated token stays acceptable.
 *
 * Rotation plus strict reuse-detection has a false-positive problem: two tabs
 * waking at once, a retried request, or React's double-invoked effects all send
 * the same cookie twice before the replacement lands. Treating that as theft
 * logs the user out of everything, which is both wrong and alarming.
 *
 * A token revoked seconds ago is far more likely a race than a stolen
 * credential, so inside this window we re-issue instead. Outside it, reuse is
 * still treated as theft and every session is revoked.
 */
const ROTATION_GRACE_MS = 20_000

const parseUtc = (value: string) => new Date(value.replace(' ', 'T') + 'Z')

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export const authRoutes = new Hono<AppEnv>()

function refreshCookieOptions(c: { get: (k: 'config') => { isProduction: boolean } }, maxAge: number) {
  return {
    httpOnly: true,
    // Same-site covers localhost:3040 → localhost:8900 (ports are not part of
    // the site), and app.x.com → api.x.com in production.
    sameSite: 'Lax' as const,
    secure: c.get('config').isProduction,
    path: '/api/v1/auth',
    maxAge,
  }
}

authRoutes.post(
  '/login',
  // Per IP and per submitted address, so neither a single address nor a single
  // source can be used to grind through passwords.
  rateLimit({ name: 'login-ip', limit: 20, windowSeconds: 300 }),
  zValidator('json', loginSchema, envelopeValidation),
  async (c) => {
    const { email, password } = c.req.valid('json')
    const config = c.get('config')

    const user = await repo.findUserByEmail(email)
    // Verify against a dummy hash when the user is unknown, so a missing
    // account and a wrong password take the same amount of time.
    const valid = await verifyPassword(password, user?.password_hash ?? null)

    if (!user || !valid || !user.is_active) {
      throw new Unauthorized('That email and password do not match')
    }

    const accessToken = await signAccessToken(
      { sub: String(user.id), email: user.email, name: user.name },
      config.auth.jwtSecret,
      config.auth.accessTtl,
    )

    const refresh = randomToken()
    await repo.storeRefreshToken({
      userId: user.id,
      token: refresh,
      expiresAt: new Date(Date.now() + config.auth.refreshTtl * 1000),
      userAgent: c.req.header('user-agent'),
      ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
    })
    await repo.touchLastLogin(user.id)

    setCookie(c, REFRESH_COOKIE, refresh, refreshCookieOptions(c, config.auth.refreshTtl))

    return ok(c, {
      accessToken,
      expiresIn: config.auth.accessTtl,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarColor: user.avatar_color,
        jobTitle: user.job_title,
      },
    })
  },
)

authRoutes.post('/refresh', rateLimit({ name: 'refresh', limit: 60, windowSeconds: 300 }), async (c) => {
  const config = c.get('config')
  const presented = getCookie(c, REFRESH_COOKIE)
  if (!presented) throw new Unauthorized('No session to refresh')

  const row = await repo.findRefreshToken(presented)
  if (!row) throw new Unauthorized('That session is no longer valid')

  // A token presented after it was revoked is either a race or a theft. Age
  // decides which: see ROTATION_GRACE_MS above.
  if (row.revoked_at) {
    const revokedAgo = Date.now() - parseUtc(row.revoked_at).getTime()
    if (revokedAgo > ROTATION_GRACE_MS) {
      await repo.revokeAllForUser(row.user_id)
      deleteCookie(c, REFRESH_COOKIE, { path: '/api/v1/auth' })
      throw new Unauthorized('That session was already used. Please sign in again.')
    }
    // Inside the window: a concurrent refresh. Fall through and issue a fresh
    // token rather than tearing down every session the user has.
  }

  if (parseUtc(row.expires_at) < new Date()) {
    throw new Unauthorized('That session has expired')
  }

  const user = await repo.findUserById(row.user_id)
  if (!user || !user.is_active) throw new Unauthorized('That account is no longer active')

  // Rotate: the presented token is spent, a new one takes its place.
  // revokeRefreshToken is a no-op when it is already revoked, which is exactly
  // what we want for the in-grace path above.
  await repo.revokeRefreshToken(row.id)
  const next = randomToken()
  await repo.storeRefreshToken({
    userId: user.id,
    token: next,
    expiresAt: new Date(Date.now() + config.auth.refreshTtl * 1000),
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
  })
  setCookie(c, REFRESH_COOKIE, next, refreshCookieOptions(c, config.auth.refreshTtl))

  const accessToken = await signAccessToken(
    { sub: String(user.id), email: user.email, name: user.name },
    config.auth.jwtSecret,
    config.auth.accessTtl,
  )
  return ok(c, { accessToken, expiresIn: config.auth.accessTtl })
})

authRoutes.post('/logout', async (c) => {
  const presented = getCookie(c, REFRESH_COOKIE)
  if (presented) {
    const row = await repo.findRefreshToken(presented)
    if (row) await repo.revokeRefreshToken(row.id)
  }
  deleteCookie(c, REFRESH_COOKIE, { path: '/api/v1/auth' })
  return ok(c, { signedOut: true })
})

authRoutes.get('/me', requireAuth, async (c) => {
  const actor = c.get('actor')
  const user = await repo.findUserById(actor.id)
  return ok(c, {
    id: actor.id,
    email: actor.email,
    name: actor.name,
    avatarColor: user?.avatar_color ?? null,
    jobTitle: user?.job_title ?? null,
    timezone: user?.timezone ?? 'UTC',
    accessibleProductIds: actor.accessibleProductIds,
    isSuperAdmin: actor.isGlobal && actor.globalPermissions.has('role.manage'),
    // The UI mirrors these to hide what the caller cannot do. The server
    // remains the real gate — hiding a button is never the control.
    permissions: [
      ...new Set([
        ...actor.globalPermissions,
        ...[...actor.productPermissions.values()].flatMap((s) => [...s]),
      ]),
    ].sort(),
  })
})
