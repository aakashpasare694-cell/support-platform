import { db } from '@/db/index.ts'
import { decryptSecret } from '@/lib/crypto.ts'
import { createProvider } from '../providers/registry.ts'
import { EmailSendError, type OutboundMessage } from '../providers/types.ts'

/**
 * Outbound email.
 *
 * Two rules shape this file:
 *
 *  1. **A reply that cannot be sent is never silently lost.** The message row
 *     is already committed before delivery is attempted, so a provider outage
 *     costs the agent their place in the thread and nothing else — the reply
 *     is stored with `delivery_status = 'failed'` and the reason, and the UI
 *     shows it on the timeline.
 *  2. **Nothing here knows a vendor's name.** Provider resolution returns a
 *     row; the registry turns that row into something with a `send()`.
 */

export interface ResolvedProvider {
  id: number
  type: string
  name: string
  sender: { name: string | null; address: string }
  replyTo: string | null
  credentials: Record<string, string>
  config: Record<string, unknown>
}

/** Why no provider could be resolved — surfaced to the agent verbatim. */
export class NoProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoProviderError'
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Product-specific mapping first, global default second, nothing third.
 *
 * The product mapping may override the sender identity, which is how one
 * Mailpit/SendGrid account serves three products with three From addresses.
 */
export async function resolveProviderForProduct(
  productId: number,
  masterKey: string,
): Promise<ResolvedProvider> {
  const mapped = await db()
    .selectFrom('sp_product_email_providers as pep')
    .innerJoin('sp_email_providers as ep', 'ep.id', 'pep.provider_id')
    .select([
      'ep.id', 'ep.type', 'ep.name', 'ep.credentials_encrypted', 'ep.config_json',
      'ep.sender_name as provider_sender_name', 'ep.sender_email as provider_sender_email',
      'pep.sender_name as map_sender_name', 'pep.sender_email as map_sender_email', 'pep.reply_to',
    ])
    .where('pep.product_id', '=', productId)
    .where('pep.is_active', '=', 1)
    .where('ep.is_enabled', '=', 1)
    .executeTakeFirst()

  const row =
    mapped ??
    (await db()
      .selectFrom('sp_email_providers as ep')
      .select([
        'ep.id', 'ep.type', 'ep.name', 'ep.credentials_encrypted', 'ep.config_json',
        'ep.sender_name as provider_sender_name', 'ep.sender_email as provider_sender_email',
      ])
      .where('ep.is_global_default', '=', 1)
      .where('ep.is_enabled', '=', 1)
      .executeTakeFirst()
      .then((r) => (r ? { ...r, map_sender_name: null, map_sender_email: null, reply_to: null } : undefined)))

  if (!row) {
    throw new NoProviderError(
      'No email provider is configured for this product and there is no enabled global default. Add one under Admin → Email providers.',
    )
  }

  const senderAddress = row.map_sender_email || row.provider_sender_email
  if (!senderAddress) {
    throw new NoProviderError(
      `Provider "${row.name}" has no sender address, so there is nothing to send from. Set one under Admin → Email providers.`,
    )
  }

  // Credentials are decrypted here and nowhere else in the request.
  let credentials: Record<string, string> = {}
  if (row.credentials_encrypted) {
    if (!masterKey) {
      throw new NoProviderError(
        'CREDENTIALS_MASTER_KEY is not set, so the stored provider credentials cannot be decrypted.',
      )
    }
    try {
      credentials = JSON.parse(await decryptSecret(row.credentials_encrypted, masterKey)) as Record<string, string>
    } catch {
      throw new NoProviderError(
        `The credentials stored for "${row.name}" could not be decrypted with the current CREDENTIALS_MASTER_KEY.`,
      )
    }
  }

  return {
    id: row.id,
    type: row.type,
    name: row.name,
    sender: { name: row.map_sender_name || row.provider_sender_name || null, address: senderAddress },
    replyTo: row.reply_to ?? null,
    credentials,
    config: parseJsonObject(row.config_json),
  }
}

/** Tests a stored provider by making a real call to the vendor. */
export async function testProvider(providerId: number, masterKey: string): Promise<{ ok: boolean; detail: string }> {
  const row = await db()
    .selectFrom('sp_email_providers')
    .select(['id', 'type', 'name', 'credentials_encrypted', 'config_json', 'is_enabled'])
    .where('id', '=', providerId)
    .executeTakeFirst()

  if (!row) return { ok: false, detail: 'That provider no longer exists.' }
  if (!row.is_enabled) return { ok: false, detail: 'Provider is disabled. Enable it before testing connectivity.' }

  let credentials: Record<string, string> = {}
  if (row.credentials_encrypted && masterKey) {
    try {
      credentials = JSON.parse(await decryptSecret(row.credentials_encrypted, masterKey)) as Record<string, string>
    } catch {
      return { ok: false, detail: 'Stored credentials could not be decrypted with the current CREDENTIALS_MASTER_KEY.' }
    }
  }

  try {
    return await createProvider(row.type, { credentials, config: parseJsonObject(row.config_json) }).testConnection()
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

interface DeliveryContext {
  ingestDomain: string
  masterKey: string
}

/**
 * Sends one already-stored outbound message.
 *
 * Returns the delivery status it wrote rather than throwing, because the
 * caller is a ticket reply that has already succeeded — the agent's text is
 * safe in the database either way.
 */
export async function deliverMessage(
  messageRowId: number,
  ctx: DeliveryContext,
): Promise<{ status: 'sent' | 'failed' | 'skipped'; detail: string }> {
  const message = await db()
    .selectFrom('sp_ticket_messages as m')
    .innerJoin('sp_tickets as t', 't.id', 'm.ticket_id')
    .select([
      'm.id', 'm.ticket_id', 'm.subject', 'm.body_html_sanitized', 'm.body_text',
      'm.message_id', 'm.visibility', 'm.message_type',
      't.product_id', 't.customer_id', 't.ticket_number',
    ])
    .where('m.id', '=', messageRowId)
    .executeTakeFirst()

  if (!message) return { status: 'skipped', detail: 'Message not found.' }
  // A private note is internal by definition and must never be mailed out.
  if (message.visibility !== 'public' || message.message_type !== 'outbound_email') {
    return { status: 'skipped', detail: 'Private note — nothing is sent to the customer.' }
  }

  const recipient = await db()
    .selectFrom('sp_customer_emails as ce')
    .innerJoin('sp_customers as c', 'c.id', 'ce.customer_id')
    .select(['ce.email', 'c.name'])
    .where('ce.customer_id', '=', message.customer_id)
    .orderBy('ce.is_primary', 'desc')
    .orderBy('ce.id', 'asc')
    .executeTakeFirst()

  if (!recipient) {
    return await mark(messageRowId, null, 'failed', 'This ticket has no customer email address to reply to.')
  }

  let provider: ResolvedProvider
  try {
    provider = await resolveProviderForProduct(message.product_id, ctx.masterKey)
  } catch (e) {
    return await mark(messageRowId, null, 'failed', e instanceof Error ? e.message : String(e))
  }

  // Thread against everything already on the ticket: In-Reply-To is the most
  // recent message, References is the chain. Clients preserve References even
  // when the subject is edited, so this is what keeps a reply on its ticket.
  const prior = await db()
    .selectFrom('sp_ticket_messages')
    .select(['message_id'])
    .where('ticket_id', '=', message.ticket_id)
    .where('id', '<', messageRowId)
    .where('message_id', 'is not', null)
    .orderBy('id', 'asc')
    .execute()

  const chain = prior.map((p) => p.message_id).filter((m): m is string => !!m)

  // The subject token is the belt-and-braces fallback for a client that drops
  // the headers entirely. ticket_number ALREADY carries the product prefix
  // ("ERP-4"), and the inbound parser matches on exactly that — prefixing it
  // again here would produce [#ERP-ERP-4] and defeat the fallback.
  const token = `[#${message.ticket_number}]`
  const baseSubject = message.subject ?? '(no subject)'
  const subject = baseSubject.includes(token) ? baseSubject : `${baseSubject} ${token}`

  const outbound: OutboundMessage = {
    from: { name: provider.sender.name, address: provider.sender.address },
    to: [{ name: recipient.name, address: recipient.email }],
    replyTo: provider.replyTo,
    subject,
    html: message.body_html_sanitized ?? '',
    text: message.body_text ?? '',
    messageId: message.message_id ?? `<t${message.ticket_id}.m${messageRowId}@${ctx.ingestDomain}>`,
    inReplyTo: chain.length ? chain[chain.length - 1] : null,
    references: chain,
  }

  try {
    const result = await createProvider(provider.type, {
      credentials: provider.credentials,
      config: provider.config,
    }).send(outbound)
    return await mark(
      messageRowId,
      provider.id,
      'sent',
      `Sent via ${provider.name} to ${recipient.email}.`,
      result.providerMessageId,
    )
  } catch (e) {
    const detail =
      e instanceof EmailSendError
        ? e.message
        : `Unexpected error while sending: ${e instanceof Error ? e.message : String(e)}`
    return await mark(messageRowId, provider.id, 'failed', detail)
  }
}

async function mark(
  messageRowId: number,
  providerId: number | null,
  status: 'sent' | 'failed',
  detail: string,
  providerMessageId?: string,
): Promise<{ status: 'sent' | 'failed'; detail: string }> {
  await db()
    .updateTable('sp_ticket_messages')
    .set({
      delivery_status: status,
      delivery_detail: detail.slice(0, 500),
      provider_id: providerId,
      ...(providerMessageId ? { provider_message_id: providerMessageId } : {}),
    })
    .where('id', '=', messageRowId)
    .execute()
  return { status, detail }
}
