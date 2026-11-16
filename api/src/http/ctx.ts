import type { Context } from 'hono'
import type { Config } from '@/config/index.ts'
import type { CacheLike } from '@/lib/cache.ts'

/**
 * Who is calling, and what they may touch.
 *
 * A grant is a role ON a product, so permissions are resolved per product. A
 * global grant (product_id IS NULL) applies everywhere — that is the only
 * "admin" concept; there is no separate flag to drift out of sync.
 */
export interface Actor {
  id: number
  email: string
  name: string
  /** Products this agent has any grant on. */
  accessibleProductIds: number[]
  isGlobal: boolean
  globalPermissions: Set<string>
  productPermissions: Map<number, Set<string>>
  /** Teams the agent belongs to — used by the `team` ticket scope. */
  teamIds: number[]
}

export function can(actor: Actor, permission: string, productId?: number): boolean {
  if (actor.globalPermissions.has(permission)) return true
  if (productId != null) return actor.productPermissions.get(productId)?.has(permission) ?? false
  // No product in scope: "could they do this anywhere?"
  for (const set of actor.productPermissions.values()) if (set.has(permission)) return true
  return false
}

/**
 * How much of a product's queue an agent may see.
 *
 * Three permissions, broadest wins:
 *   ticket.view.all       every ticket on the product
 *   ticket.view.team      tickets assigned to them or to one of their teams
 *   ticket.view.assigned  only tickets assigned to them
 *
 * This is a visibility scope, not a filter the UI applies — the SQL is built
 * from it, so a hand-crafted request cannot widen it.
 */
export type TicketScope = 'all' | 'team' | 'assigned' | 'none'

export function ticketScopeFor(actor: Actor, productId: number): TicketScope {
  if (can(actor, 'ticket.view.all', productId)) return 'all'
  if (can(actor, 'ticket.view.team', productId)) return 'team'
  if (can(actor, 'ticket.view.assigned', productId)) return 'assigned'
  return 'none'
}

/** Groups the caller's products by how much of each they may see. */
export interface ScopeGroups {
  all: number[]
  team: number[]
  assigned: number[]
}

export function scopeGroups(actor: Actor): ScopeGroups {
  const groups: ScopeGroups = { all: [], team: [], assigned: [] }
  for (const productId of actor.accessibleProductIds) {
    const scope = ticketScopeFor(actor, productId)
    if (scope !== 'none') groups[scope].push(productId)
  }
  return groups
}

/** Products the agent can see at least some tickets in. */
export function visibleProductIds(actor: Actor): number[] {
  const g = scopeGroups(actor)
  return [...g.all, ...g.team, ...g.assigned]
}

export interface Variables {
  config: Config
  cache: CacheLike
  requestId: string
  actor: Actor
}

export type AppEnv = { Variables: Variables }
export type Ctx = Context<AppEnv>

export function actorOf(c: Ctx): Actor {
  const actor = c.get('actor')
  if (!actor) throw new Error('actorOf() used on a route that is not behind requireAuth')
  return actor
}
