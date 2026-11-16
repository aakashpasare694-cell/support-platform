import { db } from '@/db/index.ts'
import type { Actor } from '@/http/ctx.ts'

/**
 * Append-only audit trail.
 *
 * One call per mutation, in the service layer. Failures are swallowed on
 * purpose: losing an audit row is bad, but failing the user's action because
 * the audit insert broke is worse — and the error still reaches the logs.
 */
export async function record(
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  diff?: Record<string, unknown>,
  context?: { ip?: string; userAgent?: string },
): Promise<void> {
  try {
    await db()
      .insertInto('sp_audit_logs')
      .values({
        actor_user_id: actor?.id ?? null,
        action,
        entity_type: entityType,
        entity_id: entityId == null ? null : String(entityId),
        diff_json: diff ? JSON.stringify(diff) : null,
        ip: context?.ip?.slice(0, 45) ?? null,
        user_agent: context?.userAgent?.slice(0, 255) ?? null,
      })
      .execute()
  } catch (err) {
    console.error('audit write failed', err)
  }
}

/** Only the fields that actually changed, as { before, after } pairs. */
export function diffOf<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const out: Record<string, { before: unknown; after: unknown }> = {}
  for (const [key, next] of Object.entries(after)) {
    if (next === undefined) continue
    if (before[key] !== next) out[key] = { before: before[key], after: next }
  }
  return out
}
