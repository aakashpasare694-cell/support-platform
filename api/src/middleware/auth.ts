import { createMiddleware } from 'hono/factory'
import { db } from '@/db/index.ts'
import { verifyAccessToken } from '@/lib/jwt.ts'
import { Forbidden, Unauthorized } from '@/http/errors.ts'
import { can, visibleProductIds, type Actor, type AppEnv } from '@/http/ctx.ts'

/**
 * Resolves the bearer token into an Actor, including the product grants and
 * permissions that every downstream check depends on.
 *
 * This is one query per request. It is a candidate for caching keyed on
 * user id + a grants version, but correctness first: a permission revoked in
 * the admin UI must take effect on the next request, not when a TTL expires.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new Unauthorized('A bearer token is required')

  const config = c.get('config')
  let claims
  try {
    claims = await verifyAccessToken(token, config.auth.jwtSecret)
  } catch {
    throw new Unauthorized('That session is invalid or has expired')
  }

  const userId = Number(claims.sub)
  if (!Number.isInteger(userId)) throw new Unauthorized('That session is invalid')

  const user = await db()
    .selectFrom('sp_users')
    .select(['id', 'email', 'name', 'is_active'])
    .where('id', '=', userId)
    .executeTakeFirst()

  // A deactivated agent keeps a valid signature until their token expires, so
  // the active check has to happen here rather than at sign-in only.
  if (!user || !user.is_active) throw new Unauthorized('That account is no longer active')

  const grants = await db()
    .selectFrom('sp_user_product_roles as upr')
    .innerJoin('sp_role_permissions as rp', 'rp.role_id', 'upr.role_id')
    .innerJoin('sp_permissions as p', 'p.id', 'rp.permission_id')
    .select(['upr.product_id', 'p.code'])
    .where('upr.user_id', '=', userId)
    .execute()

  const globalPermissions = new Set<string>()
  const productPermissions = new Map<number, Set<string>>()
  let isGlobal = false

  for (const g of grants) {
    if (g.product_id == null) {
      isGlobal = true
      globalPermissions.add(g.code)
    } else {
      const set = productPermissions.get(g.product_id) ?? new Set<string>()
      set.add(g.code)
      productPermissions.set(g.product_id, set)
    }
  }

  // A global grant means every ACTIVE product — deactivating a product hides it
  // from everyone, including super admins' ticket lists.
  let accessibleProductIds: number[]
  if (isGlobal) {
    const rows = await db()
      .selectFrom('sp_products')
      .select('id')
      .where('is_active', '=', 1)
      .execute()
    accessibleProductIds = rows.map((r) => r.id)
  } else {
    accessibleProductIds = [...productPermissions.keys()]
  }

  const teamRows = await db()
    .selectFrom('sp_team_members')
    .select('team_id')
    .where('user_id', '=', userId)
    .execute()

  const actor: Actor = {
    teamIds: teamRows.map((t) => t.team_id),
    id: user.id,
    email: user.email,
    name: user.name,
    accessibleProductIds,
    isGlobal,
    globalPermissions,
    productPermissions,
  }

  c.set('actor', actor)
  await next()
})

/**
 * Permission gate. `productFrom` lets a route say where the product in scope
 * comes from, so the check is against that product's grants rather than "any".
 */
export function requirePermission(permission: string, productFrom?: (c: never) => number | undefined) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const actor = c.get('actor')
    if (!actor) throw new Unauthorized()
    const productId = productFrom ? productFrom(c as never) : undefined
    if (!can(actor, permission, productId)) {
      throw new Forbidden(`This action needs the "${permission}" permission`)
    }
    await next()
  })
}

/**
 * Ticket reads are gated by SCOPE, not a single permission.
 *
 * Holding any of ticket.view.assigned / .team / .all on at least one product
 * is enough to reach the endpoint; how much comes back is decided by the SQL
 * predicate built from those same permissions.
 */
export const requireTicketRead = createMiddleware<AppEnv>(async (c, next) => {
  const actor = c.get('actor')
  if (!actor) throw new Unauthorized()
  if (!visibleProductIds(actor).length) {
    throw new Forbidden('You do not have ticket access on any product')
  }
  await next()
})
