import { db } from '@/db/index.ts'
import { BadRequest, NotFound } from '@/http/errors.ts'
import { scopeGroups, visibleProductIds, type Actor } from '@/http/ctx.ts'
import * as repo from './repository.ts'
import * as customers from '@/modules/customers/repository.ts'
import { deliverMessage } from '@/modules/email/outbound/service.ts'

/**
 * Ticket orchestration. No SQL here and no HTTP objects — this layer decides
 * what happens, the repository decides how it is stored.
 */

const mysqlNow = repo.mysqlNow

/** Everything the repository needs to scope a query to this caller. */
function visibilityOf(actor: Actor): repo.Visibility {
  return { userId: actor.id, teamIds: actor.teamIds, groups: scopeGroups(actor) }
}
const toMysql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')

/** Minimal HTML from plain text, paragraph per blank-line-separated block. */
function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).split('\n').join('<br/>')}</p>`)
    .join('')
}

function escapeHtml(s: string): string {
  return s
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
}

async function vocabulary() {
  const [statuses, priorities] = await Promise.all([repo.allStatuses(), repo.allPriorities()])
  return { statuses, priorities }
}

/** The one ticket row shape. List and detail both go through this. */
type Row = Awaited<ReturnType<typeof repo.getTicket>>
type TagRow = { ticket_id: number; id: number; name: string; color: string }

function mapRow(
  r: NonNullable<Row>,
  tags: TagRow[],
  last?: { id: number; message_type: string; visibility: string; body_text: string | null; created_at: string },
) {
  return {
    id: r.id,
    number: r.ticket_number,
    productId: r.product_id,
    product: { id: r.product_id, name: r.product_name, color: r.product_color },
    customerId: r.customer_id,
    customer: r.customer_id ? { id: r.customer_id, name: r.customer_name, company: r.customer_company } : null,
    subject: r.subject,
    statusCode: r.status_code,
    priorityCode: r.priority_code,
    assigneeId: r.assignee_id,
    assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name, avatarColor: r.assignee_color } : null,
    teamId: r.team_id,
    tags: tags.filter((t) => t.ticket_id === r.id).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    source: r.source,
    createdAt: r.created_at,
    lastActivityAt: r.last_activity_at,
    firstRespondedAt: r.first_responded_at,
    resolvedAt: r.resolved_at,
    frDueAt: r.fr_due_at,
    resolutionDueAt: r.resolution_due_at,
    // The list carries a preview; the detail carries the full thread instead.
    lastMessage: last
      ? {
          id: last.id,
          type: last.message_type,
          visibility: last.visibility,
          preview: (last.body_text ?? '').slice(0, 180),
          createdAt: last.created_at,
        }
      : null,
  }
}

export async function listTickets(
  actor: Actor,
  filters: repo.TicketFilters,
  page: { page: number; perPage: number },
) {
  // A product filter the caller cannot see must return nothing, not everything.
  if (filters.productId != null && !visibleProductIds(actor).includes(filters.productId)) {
    return { tickets: [], total: 0 }
  }

  const { rows, total } = await repo.listTickets(visibilityOf(actor), filters, page)
  const ids = rows.map((r) => r.id)
  const [lastMessages, tags] = await Promise.all([repo.lastMessagesFor(ids), repo.tagsFor(ids)])
  const lastByTicket = new Map(lastMessages.map((m) => [m.ticket_id, m]))

  return {
    tickets: rows.map((r) => mapRow(r as NonNullable<Row>, tags as TagRow[], lastByTicket.get(r.id))),
    total,
  }
}

export async function getTicketDetail(actor: Actor, id: number) {
  const ticket = await repo.getTicket(id, visibilityOf(actor))
  // 404 rather than 403: a 403 would confirm the id exists but is off-limits,
  // which is enough to enumerate another product's or another agent's queue.
  if (!ticket) throw new NotFound('That ticket does not exist')

  const [messages, activities, attachments, tags] = await Promise.all([
    repo.messagesFor(id),
    repo.activitiesFor(id),
    repo.attachmentsFor(id),
    repo.tagsFor([id]),
  ])

  const attachmentsByMessage = new Map<number, typeof attachments>()
  for (const a of attachments) {
    if (a.message_id == null) continue
    const list = attachmentsByMessage.get(a.message_id) ?? []
    list.push(a)
    attachmentsByMessage.set(a.message_id, list)
  }

  return {
    ...mapRow(ticket, tags as TagRow[]),
    messages: messages.map((m) => ({
      id: m.id,
      ticketId: m.ticket_id,
      type: m.message_type,
      visibility: m.visibility,
      authorId: m.author_user_id,
      authorName: m.author_name,
      authorColor: m.author_color,
      fromName: m.from_name,
      fromAddress: m.from_address,
      to: m.to_json ? (JSON.parse(String(m.to_json)) as string[]) : [],
      subject: m.subject,
      // The sanitized column is what the UI renders; the raw body is kept for
      // forensics and is never served.
      bodyHtml: m.body_html_sanitized,
      bodyText: m.body_text,
      deliveryStatus: m.delivery_status,
      // The reason a send failed belongs on the timeline. Without it an agent
      // sees "failed" and has no idea whether to retry or call an admin.
      deliveryDetail: m.delivery_detail,
      createdAt: m.created_at,
      attachments: (attachmentsByMessage.get(m.id) ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        sizeBytes: Number(a.size_bytes),
      })),
    })),
    activities: activities.map((a) => ({
      id: a.id,
      ticketId: a.ticket_id,
      actorId: a.actor_user_id,
      actorName: a.actor_name,
      action: a.action,
      field: a.field,
      oldValue: a.old_value,
      newValue: a.new_value,
      createdAt: a.created_at,
    })),
  }
}

export interface CreateTicketInput {
  productId: number
  customerId?: number
  customer?: { name: string; email: string; company?: string }
  subject: string
  description: string
  statusCode?: string
  priorityCode?: string
  assigneeId?: number | null
  teamId?: number | null
  tagIds?: number[]
  source?: string
}

export async function createTicket(actor: Actor, input: CreateTicketInput) {
  const product = await db()
    .selectFrom('sp_products')
    .select(['id', 'name', 'ticket_prefix', 'is_active'])
    .where('id', '=', input.productId)
    .executeTakeFirst()

  if (!product || !product.is_active) throw new BadRequest('That product does not exist or is inactive')

  const { statuses, priorities } = await vocabulary()
  const status =
    statuses.find((s) => s.code === (input.statusCode ?? '')) ?? statuses.find((s) => s.is_default) ?? statuses[0]
  const priority =
    priorities.find((p) => p.code === (input.priorityCode ?? '')) ??
    priorities.find((p) => p.is_default) ??
    priorities[0]

  if (!status || !priority) throw new BadRequest('Ticket statuses and priorities have not been seeded')

  const ticketId = await db().transaction().execute(async (trx) => {
    let customerId = input.customerId ?? null
    if (customerId == null) {
      if (!input.customer) throw new BadRequest('A customer is required')
      customerId = await customers.resolveOrCreate(trx, {
        email: input.customer.email,
        name: input.customer.name,
        company: input.customer.company ?? null,
        productId: input.productId,
      })
    }

    const number = await repo.nextTicketNumber(trx, product.id, product.ticket_prefix)
    const now = mysqlNow()

    const id = await repo.insertTicket(trx, {
      ticket_number: number,
      product_id: product.id,
      customer_id: customerId,
      subject: input.subject.trim(),
      status_id: status.id,
      priority_id: priority.id,
      assignee_id: input.assigneeId ?? null,
      team_id: input.teamId ?? null,
      source: input.source ?? 'manual',
      // An agent-raised ticket has had no customer-facing reply, so the
      // first-response clock starts exactly as it would for inbound email.
      fr_due_at: toMysql(new Date(Date.now() + 4 * 3_600_000)),
      resolution_due_at: toMysql(new Date(Date.now() + 24 * 3_600_000)),
      resolved_at: status.is_resolved ? now : null,
    })

    const html = textToHtml(input.description)
    await repo.insertMessage(trx, {
      ticket_id: id,
      message_type: 'inbound_email',
      visibility: 'public',
      author_user_id: null,
      from_name: input.customer?.name ?? null,
      from_address: input.customer?.email ?? null,
      to_json: null,
      subject: input.subject.trim(),
      body_html: html,
      body_html_sanitized: html,
      body_text: input.description.trim(),
      message_id: null,
      delivery_status: null,
    })

    await repo.insertActivity(trx, { ticket_id: id, actor_user_id: actor.id, action: 'created' })
    if (input.assigneeId) {
      await repo.insertActivity(trx, {
        ticket_id: id,
        actor_user_id: actor.id,
        action: 'assigned',
        field: 'assignee',
        new_value: String(input.assigneeId),
      })
    }
    if (input.tagIds?.length) await repo.setTicketTags(trx, id, input.tagIds)

    return id
  })

  return getTicketDetail(actor, ticketId)
}

/**
 * Our outgoing Message-ID encodes the ticket:
 *   <t42.m108.a1b2c3@incomingmail.charityerp.com>
 *
 * That is what makes a customer's reply land back on the right ticket even if
 * they edit the subject — the id travels in References, which clients preserve.
 */
export function buildMessageId(ticketId: number, seq: number, domain: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `<t${ticketId}.m${seq}.${rand}@${domain}>`
}

export interface AddMessageOptions {
  ingestDomain?: string
  /** Needed to decrypt provider credentials; without it nothing can be sent. */
  credentialsMasterKey?: string
}

export async function addMessage(
  actor: Actor,
  ticketId: number,
  body: string,
  visibility: 'public' | 'private',
  options: AddMessageOptions = {},
) {
  const ingestDomain = options.ingestDomain ?? 'incomingmail.charityerp.com'
  const ticket = await repo.getTicket(ticketId, visibilityOf(actor))
  if (!ticket) throw new NotFound('That ticket does not exist')

  const html = textToHtml(body)
  const now = mysqlNow()
  let messageRowId = 0

  await db().transaction().execute(async (trx) => {
    const seq = await trx
      .selectFrom('sp_ticket_messages')
      .select(({ fn }) => fn.countAll<number>().as('n'))
      .where('ticket_id', '=', ticketId)
      .executeTakeFirst()

    messageRowId = await repo.insertMessage(trx, {
      ticket_id: ticketId,
      message_type: visibility === 'private' ? 'note' : 'outbound_email',
      visibility,
      author_user_id: actor.id,
      from_name: actor.name,
      from_address: actor.email,
      to_json: null,
      subject: ticket.subject,
      body_html: html,
      body_html_sanitized: html,
      body_text: body.trim(),
      // A private note never leaves the system, so it gets no Message-ID.
      message_id:
        visibility === 'public'
          ? buildMessageId(ticketId, Number(seq?.n ?? 0) + 1, ingestDomain)
          : null,
      // Stored as 'queued' first, and only then handed to the provider. The
      // order matters: the agent's words are committed before anything that
      // can fail is attempted, so a provider outage never loses a reply.
      delivery_status: visibility === 'public' ? 'queued' : null,
    })
  })

  // Delivery is deliberately OUTSIDE the transaction and deliberately cannot
  // throw. A failed send is recorded on the message as 'failed' with the
  // reason, which the timeline shows — it is not an error on the agent's
  // request, because their reply was saved.
  if (visibility === 'public') {
    try {
      await deliverMessage(messageRowId, {
        ingestDomain,
        masterKey: options.credentialsMasterKey ?? '',
      })
    } catch (e) {
      console.error(`[outbound] delivery of message ${messageRowId} threw unexpectedly`, e)
    }
  }

  await repo.updateTicketRow(ticketId, {
    ...(visibility === 'public'
      ? {
          last_agent_reply_at: now,
          ...(ticket.first_responded_at ? {} : { first_responded_at: now }),
        }
      : {}),
  })

  return getTicketDetail(actor, ticketId)
}

export interface UpdateTicketInput {
  statusCode?: string
  priorityCode?: string
  assigneeId?: number | null
  teamId?: number | null
  tagIds?: number[]
}

export async function updateTicket(actor: Actor, ticketId: number, patch: UpdateTicketInput) {
  const ticket = await repo.getTicket(ticketId, visibilityOf(actor))
  if (!ticket) throw new NotFound('That ticket does not exist')

  const { statuses, priorities } = await vocabulary()
  const changes: Parameters<typeof repo.updateTicketRow>[1] = {}
  const activities: { action: string; field: string; oldValue: string | null; newValue: string | null }[] = []

  if (patch.statusCode && patch.statusCode !== ticket.status_code) {
    const next = statuses.find((s) => s.code === patch.statusCode)
    if (!next) throw new BadRequest(`Unknown status "${patch.statusCode}"`)
    changes.status_id = next.id
    // Semantic flags, not names: an admin can add "Waiting on Third Party"
    // and the resolution clock still behaves correctly.
    changes.resolved_at = next.is_resolved ? mysqlNow() : null
    activities.push({
      action: 'status_changed', field: 'status',
      oldValue: statuses.find((s) => s.code === ticket.status_code)?.name ?? null,
      newValue: next.name,
    })
  }

  if (patch.priorityCode && patch.priorityCode !== ticket.priority_code) {
    const next = priorities.find((p) => p.code === patch.priorityCode)
    if (!next) throw new BadRequest(`Unknown priority "${patch.priorityCode}"`)
    changes.priority_id = next.id
    activities.push({
      action: 'priority_changed', field: 'priority',
      oldValue: priorities.find((p) => p.code === ticket.priority_code)?.name ?? null,
      newValue: next.name,
    })
  }

  if (patch.assigneeId !== undefined && patch.assigneeId !== ticket.assignee_id) {
    if (patch.assigneeId != null) {
      // The assignee must themselves have access to the ticket's product.
      const allowed = await db()
        .selectFrom('sp_user_product_roles')
        .select('id')
        .where('user_id', '=', patch.assigneeId)
        .where((eb) =>
          eb.or([eb('product_id', 'is', null), eb('product_id', '=', ticket.product_id)]),
        )
        .executeTakeFirst()
      if (!allowed) throw new BadRequest('That agent does not have access to this product')
    }
    changes.assignee_id = patch.assigneeId
    activities.push({
      action: 'assigned', field: 'assignee',
      oldValue: ticket.assignee_id ? String(ticket.assignee_id) : null,
      newValue: patch.assigneeId ? String(patch.assigneeId) : null,
    })
  }

  if (patch.teamId !== undefined) changes.team_id = patch.teamId

  await db().transaction().execute(async (trx) => {
    if (patch.tagIds) await repo.setTicketTags(trx, ticketId, patch.tagIds)
    for (const a of activities) {
      await repo.insertActivity(trx, {
        ticket_id: ticketId,
        actor_user_id: actor.id,
        action: a.action,
        field: a.field,
        old_value: a.oldValue,
        new_value: a.newValue,
      })
    }
  })

  if (Object.keys(changes).length) await repo.updateTicketRow(ticketId, changes)

  return getTicketDetail(actor, ticketId)
}
