import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Transaction, Kysely } from 'kysely'
import { db, withTransaction } from '@/db/index.ts'
import type { DB } from '@/db/schema.ts'
import { actorOf, type AppEnv } from '@/http/ctx.ts'
import { created, ok } from '@/http/respond.ts'
import { BadRequest, Conflict, NotFound } from '@/http/errors.ts'
import { envelopeValidation } from '@/http/validate.ts'
import { hashPassword, randomToken } from '@/lib/crypto.ts'
import { diffOf, record } from '@/lib/audit.ts'
import { requireAuth, requirePermission } from '@/middleware/auth.ts'

/** Products, agents, teams and roles — the directory the UI renders against. */
export const directoryRoutes = new Hono<AppEnv>()
directoryRoutes.use('*', requireAuth)

directoryRoutes.get('/products', async (c) => {
  const actor = actorOf(c)
  // Only the products this agent may access. The switcher in the UI mirrors
  // this list, but the filter that matters is the one applied here.
  const rows = await db()
    .selectFrom('sp_products')
    .select(['id', 'code', 'name', 'slug', 'color', 'ticket_prefix', 'is_active', 'description'])
    .where('id', 'in', actor.accessibleProductIds.length ? actor.accessibleProductIds : [-1])
    .orderBy('name')
    .execute()

  const inbound = await db()
    .selectFrom('sp_inbound_addresses')
    .select(['product_id', 'address'])
    .where('is_active', '=', 1)
    .execute()

  return ok(
    c,
    rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      slug: p.slug,
      color: p.color,
      ticketPrefix: p.ticket_prefix,
      isActive: !!p.is_active,
      description: p.description,
      supportEmail: inbound.find((i) => i.product_id === p.id)?.address ?? null,
    })),
  )
})

directoryRoutes.get('/agents', requirePermission('agent.view'), async (c) => {
  const actor = actorOf(c)

  const users = await db()
    .selectFrom('sp_users')
    .select(['id', 'name', 'email', 'job_title', 'avatar_color', 'is_active', 'last_login_at'])
    .orderBy('name')
    .execute()

  const grants = await db()
    .selectFrom('sp_user_product_roles as upr')
    .innerJoin('sp_roles as r', 'r.id', 'upr.role_id')
    .select(['upr.user_id', 'upr.product_id', 'r.code as role_code', 'r.name as role_name'])
    .execute()

  const memberships = await db().selectFrom('sp_team_members').select(['user_id', 'team_id']).execute()

  // An agent with access to one product should not get a roster of the whole
  // business, so the list is trimmed to people who share a product with them.
  const visible = users.filter((u) => {
    if (actor.isGlobal) return true
    const theirs = grants.filter((g) => g.user_id === u.id)
    return theirs.some((g) => g.product_id == null || actor.accessibleProductIds.includes(g.product_id))
  })

  return ok(
    c,
    visible.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      jobTitle: u.job_title,
      avatarColor: u.avatar_color,
      isActive: !!u.is_active,
      lastActiveAt: u.last_login_at,
      productRoles: grants
        .filter((g) => g.user_id === u.id)
        .map((g) => ({ productId: g.product_id, roleCode: g.role_code, roleName: g.role_name })),
      teamIds: memberships.filter((m) => m.user_id === u.id).map((m) => m.team_id),
    })),
  )
})

directoryRoutes.get('/teams', requirePermission('agent.view'), async (c) => {
  const actor = actorOf(c)
  const ids = actor.accessibleProductIds.length ? actor.accessibleProductIds : [-1]

  const teams = await db()
    .selectFrom('sp_teams')
    .select(['id', 'name', 'description', 'product_id', 'is_active'])
    .where((eb) => eb.or([eb('product_id', 'is', null), eb('product_id', 'in', ids)]))
    .orderBy('name')
    .execute()

  const members = await db().selectFrom('sp_team_members').select(['team_id', 'user_id']).execute()

  return ok(
    c,
    teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      productId: t.product_id,
      isActive: !!t.is_active,
      memberIds: members.filter((m) => m.team_id === t.id).map((m) => m.user_id),
    })),
  )
})

directoryRoutes.get('/roles', requirePermission('role.manage'), async (c) => {
  const [roles, permissions, rolePermissions] = await Promise.all([
    db().selectFrom('sp_roles').selectAll().orderBy('sort_order').execute(),
    db().selectFrom('sp_permissions').selectAll().orderBy('sort_order').execute(),
    db().selectFrom('sp_role_permissions').selectAll().execute(),
  ])

  return ok(c, {
    roles: roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: !!r.is_system,
      permissionCodes: rolePermissions
        .filter((rp) => rp.role_id === r.id)
        .map((rp) => permissions.find((p) => p.id === rp.permission_id)?.code)
        .filter((x): x is string => !!x),
    })),
    permissions: permissions.map((p) => ({
      code: p.code,
      group: p.permission_group,
      label: p.label,
      description: p.description,
    })),
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Writes
//
// Every mutation is gated on its own permission, records an audit row, and
// returns the updated resource so the UI never has to guess what landed.
// ═══════════════════════════════════════════════════════════════════════════

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

// ─── Products ───────────────────────────────────────────────────────────────

const productBody = z.object({
  name: z.string().trim().min(2, 'Give the product a name'),
  code: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores').optional(),
  ticketPrefix: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only'),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4f46e5').optional(),
  description: z.string().trim().max(255).optional(),
  supportEmail: z.string().trim().email('Enter a valid address').optional(),
  isActive: z.boolean().optional(),
})

directoryRoutes.post(
  '/products',
  requirePermission('product.manage'),
  zValidator('json', productBody, envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const body = c.req.valid('json')
    const code = body.code ?? slugify(body.name).replace(/-/g, '_')
    const slug = slugify(body.name)

    const clash = await db()
      .selectFrom('sp_products')
      .select('id')
      .where((eb) => eb.or([eb('code', '=', code), eb('slug', '=', slug)]))
      .executeTakeFirst()
    if (clash) throw new Conflict('A product with that name or code already exists')

    const id = await withTransaction(async (trx) => {
      const res = await trx
        .insertInto('sp_products')
        .values({
          code,
          name: body.name,
          slug,
          description: body.description ?? null,
          color: body.color ?? '#4f46e5',
          ticket_prefix: body.ticketPrefix.toUpperCase(),
          is_active: body.isActive === false ? 0 : 1,
        })
        .executeTakeFirstOrThrow()
      const productId = Number(res.insertId)

      if (body.supportEmail) {
        await trx
          .insertInto('sp_inbound_addresses')
          .values({ address: body.supportEmail.toLowerCase(), product_id: productId, is_active: 1 })
          .execute()
      }
      // A product with no team has nowhere to route work, so it starts with one.
      await trx
        .insertInto('sp_teams')
        .values({ product_id: productId, name: `${body.name} Support`, description: `Front line for ${body.name}` })
        .execute()
      return productId
    })

    await record(actor, 'product.created', 'product', id, { name: body.name, code })
    return created(c, await productById(id))
  },
)

directoryRoutes.patch(
  '/products/:id{[0-9]+}',
  requirePermission('product.manage'),
  zValidator('json', productBody.partial(), envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const id = Number(c.req.param('id'))
    const body = c.req.valid('json')

    const before = await db().selectFrom('sp_products').selectAll().where('id', '=', id).executeTakeFirst()
    if (!before) throw new NotFound('That product does not exist')

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) { patch.name = body.name; patch.slug = slugify(body.name) }
    if (body.description !== undefined) patch.description = body.description || null
    if (body.color !== undefined) patch.color = body.color
    if (body.ticketPrefix !== undefined) patch.ticket_prefix = body.ticketPrefix.toUpperCase()
    if (body.isActive !== undefined) patch.is_active = body.isActive ? 1 : 0

    if (Object.keys(patch).length) {
      await db().updateTable('sp_products').set(patch).where('id', '=', id).execute()
    }

    if (body.supportEmail !== undefined) {
      await db().deleteFrom('sp_inbound_addresses').where('product_id', '=', id).execute()
      if (body.supportEmail) {
        await db()
          .insertInto('sp_inbound_addresses')
          .values({ address: body.supportEmail.toLowerCase(), product_id: id, is_active: 1 })
          .execute()
      }
    }

    await record(actor, 'product.updated', 'product', id, diffOf(before as never, patch as never))
    return ok(c, await productById(id))
  },
)

async function productById(id: number) {
  const p = await db()
    .selectFrom('sp_products')
    .select(['id', 'code', 'name', 'slug', 'color', 'ticket_prefix', 'is_active', 'description'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  const inbound = await db()
    .selectFrom('sp_inbound_addresses')
    .select('address')
    .where('product_id', '=', id)
    .where('is_active', '=', 1)
    .executeTakeFirst()
  return {
    id: p.id, code: p.code, name: p.name, slug: p.slug, color: p.color,
    ticketPrefix: p.ticket_prefix, isActive: !!p.is_active, description: p.description,
    supportEmail: inbound?.address ?? null,
  }
}

// ─── Agents ─────────────────────────────────────────────────────────────────

const grantSchema = z.object({
  productId: z.number().int().positive().nullable(),
  roleCode: z.string().trim().min(1),
})

const agentBody = z.object({
  name: z.string().trim().min(2, 'Enter their name'),
  email: z.string().trim().email('Enter a valid email address'),
  jobTitle: z.string().trim().max(120).optional(),
  password: z.string().min(10, 'Use at least 10 characters').optional(),
  isActive: z.boolean().optional(),
  grants: z.array(grantSchema).min(1, 'Give them access to at least one product'),
})

directoryRoutes.post(
  '/agents',
  requirePermission('agent.manage'),
  zValidator('json', agentBody, envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const body = c.req.valid('json')
    const email = body.email.toLowerCase()

    const existing = await db().selectFrom('sp_users').select('id').where('email', '=', email).executeTakeFirst()
    if (existing) throw new Conflict('An agent with that email already exists')

    // A temporary password is issued when none is given; it is returned ONCE
    // here and never retrievable again, because only its hash is stored.
    const initialPassword = body.password ?? randomToken(9)
    const id = await withTransaction(async (trx) => {
      const res = await trx
        .insertInto('sp_users')
        .values({
          email,
          name: body.name,
          password_hash: await hashPassword(initialPassword),
          job_title: body.jobTitle ?? null,
          avatar_color: pickAvatarColor(body.name),
          is_active: body.isActive === false ? 0 : 1,
        })
        .executeTakeFirstOrThrow()
      const userId = Number(res.insertId)
      await applyGrants(trx, userId, body.grants)
      return userId
    })

    await record(actor, 'agent.created', 'user', id, { email, grants: body.grants })
    return created(c, { ...(await agentById(id)), initialPassword: body.password ? undefined : initialPassword })
  },
)

directoryRoutes.patch(
  '/agents/:id{[0-9]+}',
  requirePermission('agent.manage'),
  zValidator('json', agentBody.partial(), envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const id = Number(c.req.param('id'))
    const body = c.req.valid('json')

    const before = await db().selectFrom('sp_users').selectAll().where('id', '=', id).executeTakeFirst()
    if (!before) throw new NotFound('That agent does not exist')

    // Removing your own last admin grant locks everyone out of settings, so
    // the one thing an admin cannot do is deactivate themselves.
    if (id === actor.id && body.isActive === false) {
      throw new BadRequest('You cannot deactivate your own account')
    }

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.jobTitle !== undefined) patch.job_title = body.jobTitle || null
    if (body.isActive !== undefined) patch.is_active = body.isActive ? 1 : 0
    if (body.password) patch.password_hash = await hashPassword(body.password)

    await withTransaction(async (trx) => {
      if (Object.keys(patch).length) {
        await trx.updateTable('sp_users').set(patch).where('id', '=', id).execute()
      }
      if (body.grants) {
        await trx.deleteFrom('sp_user_product_roles').where('user_id', '=', id).execute()
        await applyGrants(trx, id, body.grants)
      }
    })

    // Deactivating or re-scoping someone should take effect now, not when their
    // access token happens to expire.
    if (body.isActive === false || body.grants) {
      await db().updateTable('sp_refresh_tokens')
        .set({ revoked_at: new Date().toISOString().slice(0, 19).replace('T', ' ') })
        .where('user_id', '=', id).where('revoked_at', 'is', null).execute()
    }

    await record(actor, 'agent.updated', 'user', id, { ...diffOf(before as never, patch as never), grants: body.grants })
    return ok(c, await agentById(id))
  },
)

/** Grants are replaced wholesale, so this only ever inserts. */
async function applyGrants(
  trx: Kysely<DB>,
  userId: number,
  grants: { productId: number | null; roleCode: string }[],
) {
  for (const g of grants) {
    const role = await trx.selectFrom('sp_roles').select('id').where('code', '=', g.roleCode).executeTakeFirst()
    if (!role) throw new BadRequest(`Unknown role "${g.roleCode}"`)
    await trx
      .insertInto('sp_user_product_roles')
      .values({ user_id: userId, product_id: g.productId, role_id: role.id })
      .onConflict((oc) => oc.columns(['user_id', 'product_id', 'role_id']).doNothing())
      .execute()
  }
}

function pickAvatarColor(seed: string): string {
  const palette = ['#4f46e5', '#0d9488', '#db2777', '#ea580c', '#2563eb', '#7c3aed', '#15803d']
  let n = 0
  for (const ch of seed) n = (n + ch.charCodeAt(0)) % palette.length
  return palette[n] as string
}

async function agentById(id: number) {
  const u = await db()
    .selectFrom('sp_users')
    .select(['id', 'name', 'email', 'job_title', 'avatar_color', 'is_active', 'last_login_at'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  const grants = await db()
    .selectFrom('sp_user_product_roles as upr')
    .innerJoin('sp_roles as r', 'r.id', 'upr.role_id')
    .select(['upr.product_id', 'r.code as role_code', 'r.name as role_name'])
    .where('upr.user_id', '=', id)
    .execute()
  const teams = await db().selectFrom('sp_team_members').select('team_id').where('user_id', '=', id).execute()
  return {
    id: u.id, name: u.name, email: u.email, jobTitle: u.job_title,
    avatarColor: u.avatar_color, isActive: !!u.is_active, lastActiveAt: u.last_login_at,
    productRoles: grants.map((g) => ({ productId: g.product_id, roleCode: g.role_code, roleName: g.role_name })),
    teamIds: teams.map((t) => t.team_id),
  }
}

// ─── Teams ──────────────────────────────────────────────────────────────────

const teamBody = z.object({
  name: z.string().trim().min(2, 'Give the team a name'),
  description: z.string().trim().max(255).optional(),
  productId: z.number().int().positive().nullable().optional(),
  memberIds: z.array(z.number().int().positive()).optional(),
})

directoryRoutes.post(
  '/teams',
  requirePermission('team.manage'),
  zValidator('json', teamBody, envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const body = c.req.valid('json')
    const id = await withTransaction(async (trx) => {
      const res = await trx
        .insertInto('sp_teams')
        .values({
          name: body.name,
          description: body.description ?? null,
          product_id: body.productId ?? null,
        })
        .executeTakeFirstOrThrow()
      const teamId = Number(res.insertId)
      if (body.memberIds?.length) {
        await trx
          .insertInto('sp_team_members')
          .values(body.memberIds.map((user_id) => ({ team_id: teamId, user_id })))
          .execute()
      }
      return teamId
    })
    await record(actor, 'team.created', 'team', id, { name: body.name })
    return created(c, await teamById(id))
  },
)

directoryRoutes.patch(
  '/teams/:id{[0-9]+}',
  requirePermission('team.manage'),
  zValidator('json', teamBody.partial(), envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const id = Number(c.req.param('id'))
    const body = c.req.valid('json')

    const before = await db().selectFrom('sp_teams').selectAll().where('id', '=', id).executeTakeFirst()
    if (!before) throw new NotFound('That team does not exist')

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.description !== undefined) patch.description = body.description || null
    if (body.productId !== undefined) patch.product_id = body.productId

    await withTransaction(async (trx) => {
      if (Object.keys(patch).length) await trx.updateTable('sp_teams').set(patch).where('id', '=', id).execute()
      if (body.memberIds) {
        await trx.deleteFrom('sp_team_members').where('team_id', '=', id).execute()
        if (body.memberIds.length) {
          await trx
            .insertInto('sp_team_members')
            .values(body.memberIds.map((user_id) => ({ team_id: id, user_id })))
            .execute()
        }
      }
    })

    await record(actor, 'team.updated', 'team', id, diffOf(before as never, patch as never))
    return ok(c, await teamById(id))
  },
)

async function teamById(id: number) {
  const t = await db()
    .selectFrom('sp_teams')
    .select(['id', 'name', 'description', 'product_id', 'is_active'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  const members = await db().selectFrom('sp_team_members').select('user_id').where('team_id', '=', id).execute()
  return {
    id: t.id, name: t.name, description: t.description, productId: t.product_id,
    isActive: !!t.is_active, memberIds: members.map((m) => m.user_id),
  }
}

// ─── Roles ──────────────────────────────────────────────────────────────────

directoryRoutes.patch(
  '/roles/:code',
  requirePermission('role.manage'),
  zValidator('json', z.object({ permissionCodes: z.array(z.string()).min(0) }), envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const code = c.req.param('code')
    const { permissionCodes } = c.req.valid('json')

    const role = await db().selectFrom('sp_roles').selectAll().where('code', '=', code).executeTakeFirst()
    if (!role) throw new NotFound('That role does not exist')

    const permissions = await db().selectFrom('sp_permissions').select(['id', 'code']).execute()
    const unknown = permissionCodes.filter((p) => !permissions.some((x) => x.code === p))
    if (unknown.length) throw new BadRequest(`Unknown permission(s): ${unknown.join(', ')}`)

    // Locking yourself out of role editing is unrecoverable without SQL, so
    // the one permission Super Admin cannot drop is the one that grants it.
    if (code === 'super_admin' && !permissionCodes.includes('role.manage')) {
      throw new BadRequest('Super Admin must keep "role.manage" — removing it cannot be undone from the UI')
    }

    const before = await db()
      .selectFrom('sp_role_permissions as rp')
      .innerJoin('sp_permissions as p', 'p.id', 'rp.permission_id')
      .select('p.code')
      .where('rp.role_id', '=', role.id)
      .execute()

    await withTransaction(async (trx) => {
      await trx.deleteFrom('sp_role_permissions').where('role_id', '=', role.id).execute()
      const ids = permissions.filter((p) => permissionCodes.includes(p.code)).map((p) => p.id)
      if (ids.length) {
        await trx
          .insertInto('sp_role_permissions')
          .values(ids.map((permission_id) => ({ role_id: role.id, permission_id })))
          .execute()
      }
    })

    await record(actor, 'role.updated', 'role', role.id, {
      added: permissionCodes.filter((p) => !before.some((b) => b.code === p)),
      removed: before.map((b) => b.code).filter((p) => !permissionCodes.includes(p)),
    })

    return ok(c, { code, permissionCodes })
  },
)
