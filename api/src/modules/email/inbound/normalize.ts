import PostalMime from 'postal-mime'

/**
 * One internal shape for an inbound email, whatever delivered it.
 *
 * Cloudflare Email Workers hand over raw MIME; SendGrid and Mailgun hand over
 * their own JSON. Normalizing at the edge means the pipeline below never has
 * to know which, and adding a fourth source is one more function in this file.
 */

export interface Address {
  name: string | null
  address: string
}

export interface InboundAttachment {
  filename: string
  contentType: string
  content: Uint8Array
  contentId: string | null
  inline: boolean
}

export interface NormalizedEmail {
  /** RFC Message-ID. The primary dedupe key and threading anchor. */
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  from: Address
  to: Address[]
  cc: Address[]
  /** Set by some forwarders; checked last when resolving the product. */
  deliveredTo: string | null
  subject: string
  html: string | null
  text: string | null
  attachments: InboundAttachment[]
  receivedAt: Date
  headers: Record<string, string>
  /** True for vacation responders, list mail and anything auto-generated. */
  isAutoReply: boolean
}

const addr = (a: { name?: string | null; address?: string | null } | null | undefined): Address | null =>
  a?.address ? { name: a.name || null, address: a.address.trim().toLowerCase() } : null

const addrs = (list: readonly { name?: string | null; address?: string | null }[] | null | undefined): Address[] =>
  (list ?? []).map(addr).filter((x): x is Address => x !== null)

/** `<a@b> <c@d>` → ['<a@b>', '<c@d>'] */
export function parseReferences(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.startsWith('<') && s.endsWith('>'))
}

/**
 * Auto-reply detection.
 *
 * Without this, our reply triggers their vacation responder, which creates a
 * ticket, which we reply to… Two systems can mail each other indefinitely.
 */
export function detectAutoReply(headers: Record<string, string>): boolean {
  const auto = headers['auto-submitted']
  if (auto && auto.toLowerCase() !== 'no') return true
  if (headers['list-id'] || headers['list-unsubscribe']) return true
  const precedence = (headers['precedence'] ?? '').toLowerCase()
  if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') return true
  // Microsoft and some older servers only set this one.
  if (headers['x-auto-response-suppress']) return true
  return false
}

function headerMap(list: readonly { key: string; value: string }[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of list ?? []) out[h.key.toLowerCase()] = h.value
  return out
}

/** Cloudflare Email Workers and any raw-MIME source. */
export async function fromMime(raw: ArrayBuffer | Uint8Array | string): Promise<NormalizedEmail> {
  const parsed = await PostalMime.parse(raw as ArrayBuffer)
  const headers = headerMap(parsed.headers as never)

  return {
    messageId: parsed.messageId ?? headers['message-id'] ?? null,
    inReplyTo: parsed.inReplyTo ?? headers['in-reply-to'] ?? null,
    references: parseReferences(parsed.references ?? headers['references']),
    from: addr(parsed.from) ?? { name: null, address: 'unknown@invalid' },
    to: addrs(parsed.to),
    cc: addrs(parsed.cc),
    deliveredTo: headers['delivered-to']?.trim().toLowerCase() ?? null,
    subject: (parsed.subject ?? '').trim() || '(no subject)',
    html: parsed.html ?? null,
    text: parsed.text ?? null,
    attachments: (parsed.attachments ?? []).map((a) => ({
      filename: a.filename || 'attachment',
      contentType: a.mimeType || 'application/octet-stream',
      content: a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : new Uint8Array(),
      contentId: a.contentId ? a.contentId.replace(/^<|>$/g, '') : null,
      inline: a.disposition === 'inline',
    })),
    receivedAt: parsed.date ? new Date(parsed.date) : new Date(),
    headers,
    isAutoReply: detectAutoReply(headers),
  }
}

/** Parses `Name <a@b.com>, c@d.com` as the providers send it. */
function parseAddressList(value: string | null | undefined): Address[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => {
      const m = part.match(/^\s*(?:"?([^"<]*?)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?\s*$/)
      return m?.[2] ? { name: m[1]?.trim() || null, address: m[2].trim().toLowerCase() } : null
    })
    .filter((x): x is Address => x !== null)
}

/**
 * SendGrid Inbound Parse and Mailgun both POST multipart form data with the
 * parsed pieces as fields. They differ in naming, not in substance.
 */
export function fromProviderFields(fields: Record<string, string>): NormalizedEmail {
  // Mailgun uses "body-html"/"body-plain"; SendGrid uses "html"/"text".
  const html = fields.html ?? fields['body-html'] ?? null
  const text = fields.text ?? fields['body-plain'] ?? null

  // SendGrid sends the full header block as one string; Mailgun sends JSON.
  const headers: Record<string, string> = {}
  if (fields.headers) {
    for (const line of fields.headers.split('\n')) {
      const idx = line.indexOf(':')
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
    }
  }
  if (fields['message-headers']) {
    try {
      for (const [k, v] of JSON.parse(fields['message-headers']) as [string, string][]) {
        headers[k.toLowerCase()] = v
      }
    } catch {
      // A malformed header blob should not lose the message.
    }
  }

  const from = parseAddressList(fields.from)[0] ?? { name: null, address: 'unknown@invalid' }

  return {
    messageId: fields['Message-Id'] ?? fields['message-id'] ?? headers['message-id'] ?? null,
    inReplyTo: fields['In-Reply-To'] ?? headers['in-reply-to'] ?? null,
    references: parseReferences(fields.References ?? headers['references']),
    from,
    to: parseAddressList(fields.to),
    cc: parseAddressList(fields.cc),
    deliveredTo: (fields.envelope ? safeEnvelopeTo(fields.envelope) : null) ?? headers['delivered-to'] ?? null,
    subject: (fields.subject ?? '').trim() || '(no subject)',
    html,
    text,
    // Provider webhooks deliver attachments separately; the pipeline handles
    // an empty list fine and they can be attached later.
    attachments: [],
    receivedAt: new Date(),
    headers,
    isAutoReply: detectAutoReply(headers),
  }
}

/** SendGrid's `envelope` field is JSON: {"to":["x@y"],"from":"a@b"}. */
function safeEnvelopeTo(envelope: string): string | null {
  try {
    const parsed = JSON.parse(envelope) as { to?: string[] }
    return parsed.to?.[0]?.trim().toLowerCase() ?? null
  } catch {
    return null
  }
}

/**
 * Every address the message was addressed to, in the order the product
 * resolver should try them. Delivered-To first because a forwarded message
 * keeps the ORIGINAL recipient in To — the forwarding address only appears
 * here, and that is the one mapped to a product.
 */
export function recipientCandidates(email: NormalizedEmail): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of [
    ...(email.deliveredTo ? [{ address: email.deliveredTo }] : []),
    ...email.to,
    ...email.cc,
  ]) {
    const addr = a.address.toLowerCase()
    if (!seen.has(addr)) {
      seen.add(addr)
      out.push(addr)
    }
  }
  return out
}
