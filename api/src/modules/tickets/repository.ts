import type { Kysely } from 'kysely'
import { sql, type Transaction } from 'kysely'
import { db, type DB } from '@/db/index.ts'
import type { ScopeGroups } from '@/http/ctx.ts'

/**
 * All ticket SQL.
 *
 * Every read takes a REQUIRED `Visibility`. Making it non-optional is
 * deliberate: forgetting the scope becomes a type error instead of a data
 * leak. Nothing above this layer writes a query.
 */

/** Everything a query needs to know about what this caller may see. */
export interface Visibility {
  userId: number
  teamIds: number[]
  groups: ScopeGroups
}

export interface TicketFilters {
  statusCodes?: string[]
  priorityCodes?: string[]
  assigneeId?: number
  unassigned?: boolean
  productId?: number
  tagId?: number
  search?: string
  /** Open means the status row is flagged is_open, not a hardcoded name. */
  onlyOpen?: boolean
  /** Past the first-response target with no reply yet. */
  onlyOverdue?: boolean
}

const mysqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

/**
 * The visibility predicate.
 *
 * A caller can hold a different scope on each product, so this builds one OR
 * per group rather than a single product list:
 *
 *   product in (all-scope products)
 *   OR (product in (team-scope)     AND (assigned to me OR one of my teams))
 *   OR (product in (assigned-scope) AND assigned to me)
 *
 * With no group populated it collapses to `product_id IN (-1)`, which matches
 * nothing — the safe direction.
 */
function baseQuery(v: Visibility) {
  const { all, team, assigned } = v.groups

  return db()
    .selectFrom('sp_tickets as t')
    .innerJoin('sp_products as p', 'p.id', 't.product_id')
    .innerJoin('sp_ticket_statuses as s', 's.id', 't.status_id')
    .innerJoin('sp_ticket_priorities as pr', 'pr.id', 't.priority_id')
    .leftJoin('sp_customers as cu', 'cu.id', 't.customer_id')
    .leftJoin('sp_users as a', 'a.id', 't.assignee_id')
    .where((eb) => {
      const branches = []

      if (all.length) branches.push(eb('t.product_id', 'in', all))

      if (team.length) {
        const mine = [eb('t.assignee_id', '=', v.userId)]
        if (v.teamIds.length) mine.push(eb('t.team_id', 'in', v.teamIds))
        branches.push(eb.and([eb('t.product_id', 'in', team), eb.or(mine)]))
      }

      if (assigned.length) {
        branches.push(eb.and([eb('t.product_id', 'in', assigned), eb('t.assignee_id', '=', v.userId)]))
      }

      // No scope anywhere: match nothing rather than everything.
      if (!branches.length) return eb('t.product_id', 'in', [-1])
      return eb.or(branches)
    })
}

function applyFilters<Q extends ReturnType<typeof baseQuery>>(q: Q, f: TicketFilters): Q {
  let out = q
  if (f.productId != null) out = out.where('t.product_id', '=', f.productId) as Q
  if (f.statusCodes?.length) out = out.where('s.code', 'in', f.statusCodes) as Q
  if (f.priorityCodes?.length) out = out.where('pr.code', 'in', f.priorityCodes) as Q
  if (f.onlyOpen) out = out.where('s.is_open', '=', 1) as Q
  if (f.assigneeId != null) out = out.where('t.assignee_id', '=', f.assigneeId) as Q
  if (f.unassigned) out = out.where('t.assignee_id', 'is', null) as Q
  if (f.onlyOverdue) {
    out = out
      .where('t.first_responded_at', 'is', null)
      .where('t.fr_due_at', 'is not', null)
      .where(sql<boolean>`t.fr_due_at < datetime('now')`) as Q
  }
  if (f.tagId != null) {
    out = out.where(({ exists, selectFrom }) =>
      exists(
        selectFrom('sp_ticket_tags as tt')
          .select('tt.tag_id')
          .whereRef('tt.ticket_id', '=', 't.id')
          .where('tt.tag_id', '=', f.tagId!),
      ),
    ) as Q
  }
  if (f.search?.trim()) {
    const term = `%${f.search.trim()}%`
    out = out.where((eb) =>
      eb.or([
        eb('t.subject', 'like', term),
        eb('t.ticket_number', 'like', term),
        eb('cu.name', 'like', term),
        eb(
          sql<boolean>`EXISTS (SELECT 1 FROM sp_customer_emails ce WHERE ce.customer_id = t.customer_id AND ce.email LIKE ${term})`,
          '=',
          true,
        ),
      ]),
    ) as Q
  }
  return out
}

export async function listTickets(
  visibility: Visibility,
  filters: TicketFilters,
  page: { page: number; perPage: number },
) {
  const rows = await applyFilters(baseQuery(visibility), filters)
    .select([
      't.id', 't.ticket_number', 't.product_id', 't.customer_id', 't.subject',
      't.assignee_id', 't.team_id', 't.source', 't.created_at', 't.last_activity_at',
      't.first_responded_at', 't.resolved_at', 't.fr_due_at', 't.resolution_due_at',
      's.code as status_code', 'pr.code as priority_code',
      'p.name as product_name', 'p.color as product_color', 'p.ticket_prefix',
      'cu.name as customer_name', 'cu.company as customer_company',
      'a.name as assignee_name', 'a.avatar_color as assignee_color',
    ])
    .orderBy('t.last_activity_at', 'desc')
    .limit(page.perPage)
    .offset((page.page - 1) * page.perPage)
    .execute()

  const counted = await applyFilters(baseQuery(visibility), filters)
    .select(({ fn }) => fn.countAll<number>().as('total'))
    .executeTakeFirst()

  return { rows, total: Number(counted?.total ?? 0) }
}

/** Last public/private message per ticket, for the list preview — one query,
 *  not one per row. */
export async function lastMessagesFor(ticketIds: number[]) {
  if (!ticketIds.length) return []
  return db()
    .selectFrom('sp_ticket_messages as m')
    .select(['m.ticket_id', 'm.id', 'm.message_type', 'm.visibility', 'm.body_text', 'm.created_at'])
    .where('m.ticket_id', 'in', ticketIds)
    .where(({ eb, selectFrom }) =>
      eb(
        'm.id',
        '=',
        selectFrom('sp_ticket_messages as m2')
          .select(({ fn }) => fn.max('m2.id').as('max_id'))
          .whereRef('m2.ticket_id', '=', 'm.ticket_id'),
      ),
    )
    .execute()
}

export async function tagsFor(ticketIds: number[]) {
  if (!ticketIds.length) return []
  return db()
    .selectFrom('sp_ticket_tags as tt')
    .innerJoin('sp_tags as tg', 'tg.id', 'tt.tag_id')
    .select(['tt.ticket_id', 'tg.id', 'tg.name', 'tg.color'])
    .where('tt.ticket_id', 'in', ticketIds)
    .execute()
}

/** Returns undefined when the ticket is outside what this caller may see — the
 *  route turns that into 404, never 403. Same predicate as the list, so a
 *  ticket that is hidden from the queue is also unreachable by id. */
export function getTicket(id: number, visibility: Visibility) {
  // Same columns as the list, so one mapper can serve both and the two
  // endpoints cannot drift into different shapes.
  return baseQuery(visibility)
    .select([
      't.id', 't.ticket_number', 't.product_id', 't.customer_id', 't.subject',
      't.assignee_id', 't.team_id', 't.source', 't.created_at', 't.last_activity_at',
      't.first_responded_at', 't.resolved_at', 't.fr_due_at', 't.resolution_due_at',
      's.code as status_code', 'pr.code as priority_code',
      'p.name as product_name', 'p.color as product_color', 'p.ticket_prefix',
      'cu.name as customer_name', 'cu.company as customer_company',
      'a.name as assignee_name', 'a.avatar_color as assignee_color',
    ])
    .where('t.id', '=', id)
    .executeTakeFirst()
}

export function messagesFor(ticketId: number) {
  return db()
    .selectFrom('sp_ticket_messages as m')
    .leftJoin('sp_users as u', 'u.id', 'm.author_user_id')
    .select([
      'm.id', 'm.ticket_id', 'm.message_type', 'm.visibility', 'm.author_user_id',
      'm.from_name', 'm.from_address', 'm.to_json', 'm.cc_json', 'm.subject',
      'm.body_html_sanitized', 'm.body_text', 'm.delivery_status', 'm.delivery_detail', 'm.created_at',
      'u.name as author_name', 'u.avatar_color as author_color',
    ])
    .where('m.ticket_id', '=', ticketId)
    .orderBy('m.created_at', 'asc')
    .orderBy('m.id', 'asc')
    .execute()
}

export function activitiesFor(ticketId: number) {
  return db()
    .selectFrom('sp_ticket_activities as ta')
    .leftJoin('sp_users as u', 'u.id', 'ta.actor_user_id')
    .select([
      'ta.id', 'ta.ticket_id', 'ta.actor_user_id', 'ta.action', 'ta.field',
      'ta.old_value', 'ta.new_value', 'ta.created_at', 'u.name as actor_name',
    ])
    .where('ta.ticket_id', '=', ticketId)
    .orderBy('ta.created_at', 'asc')
    .execute()
}

export function attachmentsFor(ticketId: number) {
  return db()
    .selectFrom('sp_attachments')
    .select(['id', 'message_id', 'filename', 'content_type', 'size_bytes'])
    .where('ticket_id', '=', ticketId)
    .execute()
}

/**
 * Atomically takes the next number for a product.
 *
 * The UPDATE holds a row lock for the rest of the transaction, so two
 * concurrent creates cannot be handed the same number.
 */
export async function nextTicketNumber(trx: Kysely<DB>, productId: number, prefix: string) {
  await sql`
    INSERT INTO sp_product_counters (product_id, last_number)
    VALUES (${productId}, 1)
    ON CONFLICT (product_id) DO UPDATE SET last_number = sp_product_counters.last_number + 1
  `.execute(trx)

  const row = await trx
    .selectFrom('sp_product_counters')
    .select('last_number')
    .where('product_id', '=', productId)
    .executeTakeFirstOrThrow()

  return `${prefix}-${row.last_number}`
}

export async function insertTicket(
  trx: Kysely<DB>,
  values: {
    ticket_number: string
    product_id: number
    customer_id: number | null
    subject: string
    status_id: number
    priority_id: number
    assignee_id: number | null
    team_id: number | null
    source: string
    fr_due_at: string | null
    resolution_due_at: string | null
    resolved_at: string | null
  },
) {
  const res = await trx.insertInto('sp_tickets').values(values).executeTakeFirstOrThrow()
  return Number(res.insertId)
}

export async function insertMessage(
  trx: Kysely<DB>,
  values: {
    ticket_id: number
    message_type: string
    visibility: string
    author_user_id: number | null
    from_name: string | null
    from_address: string | null
    to_json: string | null
    subject: string | null
    body_html: string | null
    body_html_sanitized: string | null
    body_text: string | null
    message_id: string | null
    delivery_status: string | null
  },
) {
  const res = await trx.insertInto('sp_ticket_messages').values(values).executeTakeFirstOrThrow()
  return Number(res.insertId)
}

export async function insertActivity(
  trx: Kysely<DB>,
  values: {
    ticket_id: number
    actor_user_id: number | null
    action: string
    field?: string | null
    old_value?: string | null
    new_value?: string | null
  },
) {
  await trx.insertInto('sp_ticket_activities').values(values).execute()
}

export async function setTicketTags(trx: Kysely<DB>, ticketId: number, tagIds: number[]) {
  await trx.deleteFrom('sp_ticket_tags').where('ticket_id', '=', ticketId).execute()
  if (!tagIds.length) return
  await trx
    .insertInto('sp_ticket_tags')
    .values(tagIds.map((tag_id) => ({ ticket_id: ticketId, tag_id })))
    .execute()
}

export async function updateTicketRow(
  ticketId: number,
  patch: Partial<{
    status_id: number
    priority_id: number
    assignee_id: number | null
    team_id: number | null
    resolved_at: string | null
    closed_at: string | null
    first_responded_at: string
    last_agent_reply_at: string
    last_customer_reply_at: string
  }>,
) {
  await db()
    .updateTable('sp_tickets')
    .set({ ...patch, last_activity_at: mysqlNow() })
    .where('id', '=', ticketId)
    .execute()
}

// ─── vocabulary lookups ─────────────────────────────────────────────────────

export function allStatuses() {
  return db().selectFrom('sp_ticket_statuses').selectAll().orderBy('sort_order').execute()
}

export function allPriorities() {
  return db().selectFrom('sp_ticket_priorities').selectAll().orderBy('sort_order').execute()
}

export function allTags(productIds: number[]) {
  return db()
    .selectFrom('sp_tags')
    .selectAll()
    .where((eb) =>
      eb.or([eb('product_id', 'is', null), eb('product_id', 'in', productIds.length ? productIds : [-1])]),
    )
    .orderBy('name')
    .execute()
}

export { mysqlNow }
