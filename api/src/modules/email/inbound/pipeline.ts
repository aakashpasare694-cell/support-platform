import { sql } from 'kysely'
import { db } from '@/db/index.ts'
import { sha256Hex } from '@/lib/crypto.ts'
import { sanitizeEmailHtml, htmlToText, textToHtml } from '../sanitize.ts'
import { recipientCandidates, type NormalizedEmail } from './normalize.ts'
import * as ticketRepo from '@/modules/tickets/repository.ts'
import * as customerRepo from '@/modules/customers/repository.ts'

/**
 * Turns a normalized inbound email into a ticket.
 *
 * Called identically by the Email Worker handler, the provider webhook and the
 * dev .eml endpoint — there is exactly one implementation of "what happens
 * when mail arrives", so the three sources cannot drift apart.
 */

export type IngestOutcome =
  | { status: 'created'; ticketId: number; ticketNumber: string; messageId: number }
  | { status: 'appended'; ticketId: number; ticketNumber: string; messageId: number }
  | { status: 'duplicate'; ticketId: number | null; reason: string }
  | { status: 'ignored'; reason: string }
  | { status: 'unrouted'; reason: string }

const mysqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
const toSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')

/** Subject with Re:/Fwd: and a [#TICKET] token stripped, for fuzzy matching. */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/\[#[A-Za-z0-9-]+\]/g, '')
    .replace(/^\s*((re|aw|fw|fwd|antwort|sv|vs)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()
}

/** Pulls ERP-1024 out of "Re: Receipts [#ERP-1024]". */
export function ticketTokenFrom(subject: string): string | null {
  return subject.match(/\[#([A-Za-z0-9]+-\d+)\]/)?.[1] ?? null
}

/**
 * Our own outgoing Message-IDs encode the ticket:
 *   <t42.m108.a1b2c3@incomingmail.charityerp.com>
 * so a reply that preserves References threads even if the subject was edited
 * and the customer's client mangled In-Reply-To.
 */
export function ticketIdFromOwnMessageId(messageId: string): number | null {
  const m = messageId.match(/^<t(\d+)\.m\d+\./)
  return m?.[1] ? Number(m[1]) : null
}

export interface IngestInput {
  email: NormalizedEmail
  /** 'email_worker' | 'webhook:sendgrid' | 'dev' — part of the replay guard. */
  source: string
  providerEventId?: string | null
  /** Where the raw MIME was stored, so the message stays replayable. */
  rawKey?: string | null
}

export async function ingest(input: IngestInput): Promise<IngestOutcome> {
  const { email, source } = input

  // ─── Loop protection ──────────────────────────────────────────────────────
  // Vacation responders and list mail must never open a ticket, or our reply
  // bounces off their autoresponder and the two systems mail each other.
  if (email.isAutoReply) {
    await logIngest(input, 'ignored', null, 'auto-reply or list mail')
    return { status: 'ignored', reason: 'Auto-reply or list mail' }
  }

  // ─── Idempotency ──────────────────────────────────────────────────────────
  const dedupeHash = await sha256Hex(
    [email.messageId ?? '', email.from.address, email.subject, (email.text ?? email.html ?? '').slice(0, 2000)].join('\u0000'),
  )

  if (input.providerEventId) {
    const seen = await db()
      .selectFrom('sp_email_ingest_log')
      .select(['id', 'ticket_id'])
      .where('source', '=', source)
      .where('provider_event_id', '=', input.providerEventId)
      .executeTakeFirst()
    if (seen) return { status: 'duplicate', ticketId: seen.ticket_id, reason: 'This delivery was already processed' }
  }

  if (email.messageId) {
    const seen = await db()
      .selectFrom('sp_ticket_messages')
      .select(['id', 'ticket_id'])
      .where('message_id', '=', email.messageId)
      .executeTakeFirst()
    if (seen) return { status: 'duplicate', ticketId: seen.ticket_id, reason: 'This Message-ID is already on a ticket' }
  }

  const byHash = await db()
    .selectFrom('sp_email_ingest_log')
    .select(['id', 'ticket_id'])
    .where('dedupe_hash', '=', dedupeHash)
    .executeTakeFirst()
  if (byHash) return { status: 'duplicate', ticketId: byHash.ticket_id, reason: 'An identical message was already received' }

  // ─── Which product? ───────────────────────────────────────────────────────
  const candidates = recipientCandidates(email)
  const route = candidates.length
    ? await db()
        .selectFrom('sp_inbound_addresses as ia')
        .innerJoin('sp_products as p', 'p.id', 'ia.product_id')
        .select(['ia.address', 'p.id as product_id', 'p.name as product_name', 'p.ticket_prefix', 'p.is_active'])
        .where('ia.address', 'in', candidates)
        .where('ia.is_active', '=', 1)
        .executeTakeFirst()
    : undefined

  if (!route || !route.is_active) {
    // Held, not dropped. An unroutable message is an admin problem, and the
    // raw copy plus this row is what lets them fix the mapping and replay.
    await logIngest(input, 'unrouted', dedupeHash, `No active inbound address matched: ${candidates.join(', ') || 'none'}`)
    return { status: 'unrouted', reason: `No product is configured for ${candidates.join(', ') || 'this recipient'}` }
  }

  // ─── Existing thread? ─────────────────────────────────────────────────────
  const existingTicketId = await resolveThread(email, route.product_id)

  // ─── Customer ─────────────────────────────────────────────────────────────
  const sanitizedHtml = email.html ? sanitizeEmailHtml(email.html) : textToHtml(email.text ?? '')
  const bodyText = email.text ?? htmlToText(email.html ?? '')

  const result = await db().transaction().execute(async (trx) => {
    const customerId = await customerRepo.resolveOrCreate(trx, {
      email: email.from.address,
      name: email.from.name || email.from.address.split('@')[0] || email.from.address,
      productId: route.product_id,
    })

    let ticketId = existingTicketId
    let ticketNumber: string
    let created = false

    if (ticketId) {
      const t = await trx
        .selectFrom('sp_tickets')
        .select(['ticket_number', 'status_id'])
        .where('id', '=', ticketId)
        .executeTakeFirst()
      ticketNumber = t?.ticket_number ?? ''

      // A reply to a resolved ticket reopens it — the customer is still
      // talking, so the queue should reflect that.
      const status = t
        ? await trx.selectFrom('sp_ticket_statuses').select(['is_resolved']).where('id', '=', t.status_id).executeTakeFirst()
        : undefined
      if (status?.is_resolved) {
        const reopen = await trx
          .selectFrom('sp_ticket_statuses')
          .select('id')
          .where('is_open', '=', 1)
          .orderBy('sort_order')
          .executeTakeFirst()
        if (reopen) {
          await trx
            .updateTable('sp_tickets')
            .set({ status_id: reopen.id, resolved_at: null, closed_at: null })
            .where('id', '=', ticketId)
            .execute()
          await ticketRepo.insertActivity(trx, {
            ticket_id: ticketId,
            actor_user_id: null,
            action: 'reopened',
            field: 'status',
            new_value: 'Reopened by customer reply',
          })
        }
      }
    } else {
      const [status, priority] = await Promise.all([
        trx.selectFrom('sp_ticket_statuses').selectAll().orderBy('is_default', 'desc').orderBy('sort_order').executeTakeFirstOrThrow(),
        trx.selectFrom('sp_ticket_priorities').selectAll().orderBy('is_default', 'desc').orderBy('sort_order').executeTakeFirstOrThrow(),
      ])

      ticketNumber = await ticketRepo.nextTicketNumber(trx, route.product_id, route.ticket_prefix)
      ticketId = await ticketRepo.insertTicket(trx, {
        ticket_number: ticketNumber,
        product_id: route.product_id,
        customer_id: customerId,
        subject: email.subject,
        status_id: status.id,
        priority_id: priority.id,
        assignee_id: null,
        team_id: null,
        source: 'email',
        fr_due_at: toSql(new Date(Date.now() + 4 * 3_600_000)),
        resolution_due_at: toSql(new Date(Date.now() + 24 * 3_600_000)),
        resolved_at: null,
      })
      await ticketRepo.insertActivity(trx, { ticket_id: ticketId, actor_user_id: null, action: 'created' })
      created = true
    }

    const messageId = await ticketRepo.insertMessage(trx, {
      ticket_id: ticketId,
      message_type: 'inbound_email',
      visibility: 'public',
      author_user_id: null,
      from_name: email.from.name,
      from_address: email.from.address,
      to_json: JSON.stringify(email.to.map((t) => t.address)),
      subject: email.subject,
      // Raw is kept for forensics; only the sanitized column is ever rendered.
      body_html: email.html,
      body_html_sanitized: sanitizedHtml,
      body_text: bodyText,
      message_id: email.messageId,
      delivery_status: null,
    })

    await trx
      .updateTable('sp_tickets')
      .set({ last_activity_at: mysqlNow(), last_customer_reply_at: mysqlNow() })
      .where('id', '=', ticketId)
      .execute()

    if (email.attachments.length) {
      await trx
        .insertInto('sp_attachments')
        .values(
          email.attachments.map((a) => ({
            message_id: messageId,
            ticket_id: ticketId as number,
            product_id: route.product_id,
            filename: a.filename.slice(0, 255),
            content_type: a.contentType.slice(0, 150),
            size_bytes: a.content.byteLength,
            // Object storage lands with the R2 adapter; the row records what
            // arrived so nothing is silently lost in the meantime.
            r2_key: `pending/${ticketId}/${messageId}/${a.filename}`.slice(0, 500),
            is_inline: a.inline ? 1 : 0,
            content_id: a.contentId,
          })),
        )
        .execute()
    }

    return { ticketId: ticketId as number, ticketNumber, messageId, created }
  })

  await logIngest(input, 'processed', dedupeHash, null, result.ticketId)

  return result.created
    ? { status: 'created', ticketId: result.ticketId, ticketNumber: result.ticketNumber, messageId: result.messageId }
    : { status: 'appended', ticketId: result.ticketId, ticketNumber: result.ticketNumber, messageId: result.messageId }
}

/**
 * Four ways to find the thread, strongest first. Each is a fallback for a real
 * failure of the one above it: clients drop In-Reply-To, people edit subjects,
 * and some forwarders rewrite headers entirely.
 */
async function resolveThread(email: NormalizedEmail, productId: number): Promise<number | null> {
  // 1. Our own Message-ID encodes the ticket id — survives subject edits.
  for (const ref of [email.inReplyTo, ...email.references].filter((x): x is string => !!x)) {
    const own = ticketIdFromOwnMessageId(ref)
    if (own) {
      const exists = await db()
        .selectFrom('sp_tickets')
        .select('id')
        .where('id', '=', own)
        .where('product_id', '=', productId)
        .executeTakeFirst()
      if (exists) return exists.id
    }
  }

  // 2. In-Reply-To / References matched against stored Message-IDs.
  const refs = [email.inReplyTo, ...email.references].filter((x): x is string => !!x)
  if (refs.length) {
    const hit = await db()
      .selectFrom('sp_ticket_messages as m')
      .innerJoin('sp_tickets as t', 't.id', 'm.ticket_id')
      .select('t.id')
      .where('m.message_id', 'in', refs)
      .where('t.product_id', '=', productId)
      .executeTakeFirst()
    if (hit) return hit.id
  }

  // 3. A [#ERP-1024] token in the subject.
  const token = ticketTokenFrom(email.subject)
  if (token) {
    const hit = await db()
      .selectFrom('sp_tickets')
      .select('id')
      .where('ticket_number', '=', token)
      .where('product_id', '=', productId)
      .executeTakeFirst()
    if (hit) return hit.id
  }

  // 4. Same sender, same normalized subject, recent, still open. Deliberately
  //    last and deliberately narrow — this one can produce false positives.
  const normalized = normalizeSubject(email.subject)
  if (normalized) {
    const hit = await db()
      .selectFrom('sp_tickets as t')
      .innerJoin('sp_customer_emails as ce', 'ce.customer_id', 't.customer_id')
      .innerJoin('sp_ticket_statuses as s', 's.id', 't.status_id')
      .select('t.id')
      .where('ce.email', '=', email.from.address)
      .where('t.product_id', '=', productId)
      .where('s.is_open', '=', 1)
      .where(sql<boolean>`t.created_at > datetime('now', '-7 days')`)
      .where(sql<boolean>`lower(trim(replace(t.subject, '[#' || t.ticket_number || ']', ''))) = ${normalized}`)
      .orderBy('t.id', 'desc')
      .executeTakeFirst()
    if (hit) return hit.id
  }

  return null
}

async function logIngest(
  input: IngestInput,
  status: string,
  dedupeHash: string | null,
  error: string | null,
  ticketId?: number,
) {
  try {
    await db()
      .insertInto('sp_email_ingest_log')
      .values({
        source: input.source,
        provider_event_id: input.providerEventId ?? null,
        message_id: input.email.messageId,
        dedupe_hash: dedupeHash,
        raw_r2_key: input.rawKey ?? null,
        status,
        ticket_id: ticketId ?? null,
        error,
      })
      .execute()
  } catch (err) {
    // A duplicate hash racing in is exactly what the unique index is for.
    console.error('ingest log write failed', err)
  }
}
