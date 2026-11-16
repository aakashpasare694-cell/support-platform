import { Hono } from 'hono'
import { z } from 'zod'
import { actorOf, type AppEnv } from '@/http/ctx.ts'
import { ok, paginated } from '@/http/respond.ts'
import { zValidator } from '@hono/zod-validator'
import { envelopeValidation } from '@/http/validate.ts'
import { NotFound } from '@/http/errors.ts'
import { requireAuth, requirePermission } from '@/middleware/auth.ts'
import * as repo from './repository.ts'
import * as tickets from '@/modules/tickets/service.ts'

export const customerRoutes = new Hono<AppEnv>()
customerRoutes.use('*', requireAuth)

const listQuery = z.object({
  q: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
})

customerRoutes.get('/', requirePermission('customer.view'), zValidator('query', listQuery, envelopeValidation), async (c) => {
  const actor = actorOf(c)
  const { q, page, perPage } = c.req.valid('query')

  const { rows, total } = await repo.list(actor.accessibleProductIds, q, { page, perPage })
  const ids = rows.map((r) => r.id)
  const [emails, products] = await Promise.all([repo.emailsFor(ids), repo.productsFor(ids)])

  return paginated(
    c,
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      company: r.company,
      phone: r.phone,
      timezone: r.timezone,
      createdAt: r.created_at,
      emails: emails.filter((e) => e.customer_id === r.id).map((e) => e.email),
      // Only the associations the caller can see — a customer may also use a
      // product this agent is not authorized for.
      productIds: products
        .filter((p) => p.customer_id === r.id && actor.accessibleProductIds.includes(p.product_id))
        .map((p) => p.product_id),
    })),
    { page, perPage, total },
  )
})

customerRoutes.get('/:id{[0-9]+}', requirePermission('customer.view'), async (c) => {
  const actor = actorOf(c)
  const id = Number(c.req.param('id'))

  const customer = await repo.getById(id, actor.accessibleProductIds)
  if (!customer) throw new NotFound('That customer does not exist')

  const [emails, products, history] = await Promise.all([
    repo.emailsFor([id]),
    repo.productsFor([id]),
    tickets.listTickets(actor, {}, { page: 1, perPage: 50 }),
  ])

  return ok(c, {
    id: customer.id,
    name: customer.name,
    company: customer.company,
    phone: customer.phone,
    timezone: customer.timezone,
    notes: customer.notes,
    createdAt: customer.created_at,
    emails: emails.map((e) => e.email),
    productIds: products
      .filter((p) => actor.accessibleProductIds.includes(p.product_id))
      .map((p) => p.product_id),
    tickets: history.tickets.filter((t) => t.customerId === id),
  })
})
