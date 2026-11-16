import { Hono } from 'hono'
import { z } from 'zod'
import { actorOf, can, type AppEnv } from '@/http/ctx.ts'
import { created, ok, paginated } from '@/http/respond.ts'
import { zValidator } from '@hono/zod-validator'
import { envelopeValidation } from '@/http/validate.ts'
import { BadRequest, Forbidden } from '@/http/errors.ts'
import { requireAuth, requirePermission, requireTicketRead } from '@/middleware/auth.ts'
import * as service from './service.ts'
import * as repo from './repository.ts'

export const ticketRoutes = new Hono<AppEnv>()
ticketRoutes.use('*', requireAuth)

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  productId: z.coerce.number().int().positive().optional(),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  priority: z.union([z.string(), z.array(z.string())]).optional(),
  assignee: z.string().optional(),
  tagId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
  view: z.enum(['all', 'open', 'mine', 'unassigned', 'overdue']).default('all'),
})

const asArray = (v: string | string[] | undefined) => (v == null ? undefined : Array.isArray(v) ? v : [v])

ticketRoutes.get('/', requireTicketRead, zValidator('query', listQuery, envelopeValidation), async (c) => {
  const actor = actorOf(c)
  const q = c.req.valid('query')

  const filters: repo.TicketFilters = {
    productId: q.productId,
    statusCodes: asArray(q.status),
    priorityCodes: asArray(q.priority),
    tagId: q.tagId,
    search: q.q,
    onlyOpen: q.view === 'open',
    onlyOverdue: q.view === 'overdue',
    unassigned: q.view === 'unassigned',
    assigneeId: q.view === 'mine' ? actor.id : q.assignee ? Number(q.assignee) : undefined,
  }
  // "Unassigned" means unassigned AND still open — a closed ticket with no
  // owner is not work waiting for someone.
  if (q.view === 'unassigned') filters.onlyOpen = true

  const { tickets, total } = await service.listTickets(actor, filters, { page: q.page, perPage: q.perPage })
  return paginated(c, tickets, { page: q.page, perPage: q.perPage, total })
})

/** Reference data the UI needs to render filters and badges. */
ticketRoutes.get('/meta', async (c) => {
  const actor = actorOf(c)
  const [statuses, priorities, tags] = await Promise.all([
    repo.allStatuses(),
    repo.allPriorities(),
    repo.allTags(actor.accessibleProductIds),
  ])
  return ok(c, {
    statuses: statuses.map((s) => ({
      id: s.id, code: s.code, name: s.name, color: s.color,
      isOpen: !!s.is_open, isResolved: !!s.is_resolved, pausesSla: !!s.pauses_sla, isDefault: !!s.is_default,
    })),
    priorities: priorities.map((p) => ({
      id: p.id, code: p.code, name: p.name, color: p.color, weight: p.weight, isDefault: !!p.is_default,
    })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, productId: t.product_id })),
  })
})

ticketRoutes.get('/:id{[0-9]+}', requireTicketRead, async (c) => {
  const actor = actorOf(c)
  return ok(c, await service.getTicketDetail(actor, Number(c.req.param('id'))))
})

const createSchema = z
  .object({
    productId: z.number().int().positive(),
    customerId: z.number().int().positive().optional(),
    customer: z
      .object({
        name: z.string().trim().min(1, 'Enter the customer’s name'),
        email: z.string().trim().email('Enter a valid email address'),
        company: z.string().trim().optional(),
      })
      .optional(),
    subject: z.string().trim().min(3, 'Give the ticket a subject of at least 3 characters'),
    description: z.string().trim().min(1, 'Describe what the customer needs'),
    statusCode: z.string().optional(),
    priorityCode: z.string().optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
    teamId: z.number().int().positive().nullable().optional(),
    tagIds: z.array(z.number().int().positive()).optional(),
    source: z.enum(['manual', 'phone', 'email', 'api']).optional(),
  })
  .refine((v) => v.customerId != null || v.customer != null, {
    message: 'Pick an existing customer or provide a new one',
    path: ['customerId'],
  })

ticketRoutes.post('/', zValidator('json', createSchema, envelopeValidation), async (c) => {
  const actor = actorOf(c)
  const input = c.req.valid('json')

  // Permission is checked against the product being filed into, not "anywhere".
  if (!can(actor, 'ticket.create', input.productId)) {
    throw new Forbidden('You cannot create tickets for that product')
  }
  if (!actor.accessibleProductIds.includes(input.productId)) {
    throw new Forbidden('You do not have access to that product')
  }

  const ticket = await service.createTicket(actor, {
    ...input,
    source: input.source === 'phone' ? 'manual' : input.source,
  })
  return created(c, ticket)
})

const messageSchema = z.object({ body: z.string().trim().min(1, 'Write something first') })

ticketRoutes.post('/:id{[0-9]+}/reply', requirePermission('ticket.reply'), zValidator('json', messageSchema, envelopeValidation), async (c) => {
  const actor = actorOf(c)
  const { body } = c.req.valid('json')
  const config = c.get('config')
  return created(
    c,
    await service.addMessage(actor, Number(c.req.param('id')), body, 'public', {
      ingestDomain: config.ingestDomain,
      credentialsMasterKey: config.credentialsMasterKey,
    }),
  )
})

ticketRoutes.post('/:id{[0-9]+}/notes', requirePermission('ticket.note'), zValidator('json', messageSchema, envelopeValidation), async (c) => {
  const actor = actorOf(c)
  const { body } = c.req.valid('json')
  return created(c, await service.addMessage(actor, Number(c.req.param('id')), body, 'private'))
})

const patchSchema = z.object({
  statusCode: z.string().optional(),
  priorityCode: z.string().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  teamId: z.number().int().positive().nullable().optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
})

ticketRoutes.patch('/:id{[0-9]+}', zValidator('json', patchSchema, envelopeValidation), async (c) => {
  const actor = actorOf(c)
  const patch = c.req.valid('json')
  if (!Object.keys(patch).length) throw new BadRequest('Nothing to change')

  // Each field needs its own permission — an agent may be allowed to change
  // status but not to reassign.
  if (patch.statusCode && !can(actor, 'ticket.status.change')) throw new Forbidden('You cannot change ticket status')
  if (patch.priorityCode && !can(actor, 'ticket.priority.change')) throw new Forbidden('You cannot change ticket priority')
  if (patch.assigneeId !== undefined) {
    // Taking a ticket yourself and handing one to someone else are different
    // privileges — a junior agent often has the first but not the second.
    const toSelf = patch.assigneeId === actor.id
    const allowed = toSelf
      ? can(actor, 'ticket.assign.self') || can(actor, 'ticket.assign.others')
      : can(actor, 'ticket.assign.others')
    if (!allowed) {
      throw new Forbidden(toSelf ? 'You cannot take tickets' : 'You cannot assign tickets to other agents')
    }
  }
  if (patch.tagIds && !can(actor, 'ticket.tag')) throw new Forbidden('You cannot change tags')

  return ok(c, await service.updateTicket(actor, Number(c.req.param('id')), patch))
})
