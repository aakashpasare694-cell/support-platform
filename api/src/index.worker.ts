import { Kysely } from 'kysely'
import { D1Dialect } from 'kysely-d1'
import { createApp } from './app.ts'
import { runWithDb } from './db/index.ts'
import { fromMime } from './modules/email/inbound/normalize.ts'
import { ingest } from './modules/email/inbound/pipeline.ts'
import type { Env } from './config/index.ts'
import type { DB } from './db/schema.ts'

/**
 * Cloudflare's inbound email message. Typed locally rather than pulling in
 * @cloudflare/workers-types, which this project does not otherwise need.
 */
interface ForwardableEmailMessage {
  readonly from: string
  readonly to: string
  readonly raw: ReadableStream<Uint8Array>
  readonly rawSize: number
  setReject(reason: string): void
}

/**
 * Workers entry.
 *
 * D1 is the same SQLite engine as local development, so everything in
 * `migrations/` and every query in the codebase runs here unchanged — only the
 * driver differs (`kysely-d1` here, better-sqlite3 in `src/index.ts`).
 *
 * Each request gets its own Kysely instance scoped through AsyncLocalStorage,
 * so no module below has to be told which runtime it is in.
 */

/**
 * A Kysely instance over the request's D1 binding.
 *
 * Built per request rather than cached in module scope: an isolate is reused
 * across requests that may carry different bindings, and holding one is how a
 * stale handle outlives the environment it came from.
 */
function scopedDb(env: Env): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new D1Dialect({ database: env.DB as ConstructorParameters<typeof D1Dialect>[0]['database'] }),
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = createApp(env)

    if (!env.DB) {
      return Response.json(
        { success: false, error: { code: 'NO_DATABASE', message: 'D1 binding "DB" is not configured' } },
        { status: 500 },
      )
    }

    return runWithDb(scopedDb(env), () => app.fetch(request, env, ctx))
  },

  /**
   * Inbound mail, straight from Cloudflare Email Routing.
   *
   * This is the primary ingest path: no webhook secret to rotate, no vendor in
   * between, and the raw MIME arrives as a stream. It runs the SAME `ingest()`
   * as the webhook and the dev .eml endpoint, so threading, dedupe and product
   * routing cannot diverge between sources.
   *
   * Attach it in the Cloudflare dashboard: Email Routing -> Routing rules ->
   * send the product address (erp@incomingmail.charityerp.com) to this Worker.
   */
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.DB) {
      // Rejecting tells the sending server to retry rather than silently
      // dropping a customer's email.
      message.setReject('Support platform database is unavailable; please retry.')
      return
    }

    const raw = await new Response(message.raw).arrayBuffer()

    await runWithDb(scopedDb(env), async () => {
      const email = await fromMime(raw)
      const outcome = await ingest({
        email,
        source: 'email_worker',
        // Cloudflare does not supply its own event id, so the RFC Message-ID
        // is the dedupe key. The pipeline has two more guards behind it.
        providerEventId: email.messageId,
      })

      // An unrouted message is NOT an error: it lands in the holding queue for
      // an admin to triage, which is why nothing is rejected here.
      console.log(
        `[email] ${message.from} -> ${message.to}: ${outcome.status}` +
          ('ticketNumber' in outcome && outcome.ticketNumber ? ` (${outcome.ticketNumber})` : ''),
      )
    })
  },
}
