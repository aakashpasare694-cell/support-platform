import { Hono } from 'hono'
import { sql } from 'kysely'
import { db } from '@/db/index.ts'
import { actorOf, type AppEnv } from '@/http/ctx.ts'
import { ok } from '@/http/respond.ts'
import { requireAuth, requirePermission } from '@/middleware/auth.ts'

export const reportRoutes = new Hono<AppEnv>()
reportRoutes.use('*', requireAuth)

/**
 * Dashboard figures.
 *
 * Aggregates are raw SQL rather than the query builder: they are read-only,
 * shaped for one screen, and far clearer written out than assembled.
 * Everything is scoped to the caller's products — a report must never be the
 * hole that leaks another product's numbers.
 */
reportRoutes.get('/overview', requirePermission('report.view'), async (c) => {
  const actor = actorOf(c)
  const ids = actor.accessibleProductIds.length ? actor.accessibleProductIds : [-1]

  const totals = await db()
    .selectFrom('sp_tickets as t')
    .innerJoin('sp_ticket_statuses as s', 's.id', 't.status_id')
    .select(({ fn }) => [
      fn.countAll<number>().as('total'),
      sql<number>`SUM(CASE WHEN s.is_open = 1 THEN 1 ELSE 0 END)`.as('open_count'),
      sql<number>`SUM(CASE WHEN s.is_open = 1 AND t.assignee_id IS NULL THEN 1 ELSE 0 END)`.as('unassigned'),
      sql<number>`SUM(CASE WHEN s.is_open = 1 AND t.first_responded_at IS NULL AND t.fr_due_at IS NOT NULL AND t.fr_due_at < datetime('now') THEN 1 ELSE 0 END)`.as('overdue'),
      sql<number>`SUM(CASE WHEN t.resolved_at IS NOT NULL AND t.resolved_at > datetime('now', '-1 day') THEN 1 ELSE 0 END)`.as('resolved_today'),
      sql<number>`AVG(CASE WHEN t.first_responded_at IS NOT NULL THEN (julianday(t.first_responded_at) - julianday(t.created_at)) * 1440 END)`.as('avg_first_response'),
    ])
    .where('t.product_id', 'in', ids)
    .executeTakeFirst()

  const byProduct = await db()
    .selectFrom('sp_tickets as t')
    .innerJoin('sp_products as p', 'p.id', 't.product_id')
    .innerJoin('sp_ticket_statuses as s', 's.id', 't.status_id')
    .select(({ fn }) => [
      'p.id as product_id', 'p.name as product_name', 'p.color as product_color',
      fn.countAll<number>().as('total'),
      sql<number>`SUM(CASE WHEN s.is_open = 1 THEN 1 ELSE 0 END)`.as('open_count'),
    ])
    .where('t.product_id', 'in', ids)
    .groupBy(['p.id', 'p.name', 'p.color'])
    .execute()

  const byStatus = await db()
    .selectFrom('sp_ticket_statuses as s')
    .leftJoin('sp_tickets as t', (join) =>
      join.onRef('t.status_id', '=', 's.id').on('t.product_id', 'in', ids),
    )
    .select(({ fn }) => ['s.code', 's.name', 's.color', fn.count<number>('t.id').as('count')])
    .groupBy(['s.id', 's.code', 's.name', 's.color', 's.sort_order'])
    .orderBy('s.sort_order')
    .execute()

  const byPriority = await db()
    .selectFrom('sp_ticket_priorities as pr')
    .leftJoin('sp_tickets as t', (join) => join.onRef('t.priority_id', '=', 'pr.id').on('t.product_id', 'in', ids))
    .leftJoin('sp_ticket_statuses as s', 's.id', 't.status_id')
    .select([
      'pr.code', 'pr.name', 'pr.color',
      sql<number>`SUM(CASE WHEN s.is_open = 1 THEN 1 ELSE 0 END)`.as('count'),
    ])
    .groupBy(['pr.id', 'pr.code', 'pr.name', 'pr.color', 'pr.sort_order'])
    .orderBy('pr.sort_order')
    .execute()

  const byAgent = await db()
    .selectFrom('sp_tickets as t')
    .innerJoin('sp_users as u', 'u.id', 't.assignee_id')
    .innerJoin('sp_ticket_statuses as s', 's.id', 't.status_id')
    .select([
      'u.id as agent_id', 'u.name as agent_name', 'u.avatar_color',
      sql<number>`SUM(CASE WHEN s.is_open = 1 THEN 1 ELSE 0 END)`.as('assigned'),
      sql<number>`SUM(CASE WHEN s.is_resolved = 1 THEN 1 ELSE 0 END)`.as('resolved'),
    ])
    .where('t.product_id', 'in', ids)
    .groupBy(['u.id', 'u.name', 'u.avatar_color'])
    .execute()

  const volume = await db()
    .selectFrom('sp_tickets as t')
    .select([
      sql<string>`date(t.created_at)`.as('day'),
      sql<number>`COUNT(*)`.as('created'),
      sql<number>`SUM(CASE WHEN date(t.resolved_at) = date(t.created_at) THEN 1 ELSE 0 END)`.as('resolved_same_day'),
    ])
    .where('t.product_id', 'in', ids)
    .where(sql<boolean>`t.created_at >= datetime('now', '-14 days')`)
    .groupBy(sql`date(t.created_at)`)
    .orderBy(sql`date(t.created_at)`)
    .execute()

  const resolvedByDay = await db()
    .selectFrom('sp_tickets as t')
    .select([sql<string>`date(t.resolved_at)`.as('day'), sql<number>`COUNT(*)`.as('resolved')])
    .where('t.product_id', 'in', ids)
    .where('t.resolved_at', 'is not', null)
    .where(sql<boolean>`t.resolved_at >= datetime('now', '-14 days')`)
    .groupBy(sql`date(t.resolved_at)`)
    .execute()

  return ok(c, {
    total: Number(totals?.total ?? 0),
    open: Number(totals?.open_count ?? 0),
    unassigned: Number(totals?.unassigned ?? 0),
    overdue: Number(totals?.overdue ?? 0),
    resolvedToday: Number(totals?.resolved_today ?? 0),
    avgFirstResponseMins: Math.round(Number(totals?.avg_first_response ?? 0)),
    byProduct: byProduct.map((r) => ({
      productId: r.product_id, name: r.product_name, color: r.product_color,
      total: Number(r.total), open: Number(r.open_count),
    })),
    byStatus: byStatus.map((r) => ({ code: r.code, name: r.name, color: r.color, count: Number(r.count) })),
    byPriority: byPriority.map((r) => ({ code: r.code, name: r.name, color: r.color, count: Number(r.count ?? 0) })),
    byAgent: byAgent.map((r) => ({
      agentId: r.agent_id, name: r.agent_name, avatarColor: r.avatar_color,
      assigned: Number(r.assigned ?? 0), resolved: Number(r.resolved ?? 0),
    })),
    volume: volume.map((v) => ({
      day: String(v.day),
      created: Number(v.created),
      resolved: Number(resolvedByDay.find((r) => String(r.day) === String(v.day))?.resolved ?? 0),
    })),
  })
})
