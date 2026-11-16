import type { Addressee, EmailProvider, OutboundMessage, ProviderDefinition, TestResult } from './types.ts'
import { EmailSendError } from './types.ts'

/**
 * Resend (https://resend.com) — a production sending provider.
 *
 * Plain HTTPS + Bearer token, so it runs unchanged on Workers and on Node.
 * Threading headers go in the `headers` field; Resend passes them through,
 * which is what keeps a customer's reply attached to its ticket.
 */

const API = 'https://api.resend.com'

const fmt = (a: Addressee): string => (a.name ? `${a.name} <${a.address}>` : a.address)

class ResendProvider implements EmailProvider {
  readonly type = 'resend'

  constructor(private readonly apiKey: string) {}

  private headers() {
    return { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }
  }

  async send(msg: OutboundMessage) {
    if (!this.apiKey) throw new EmailSendError('Resend API key is not configured.')

    const headers: Record<string, string> = { 'Message-ID': msg.messageId }
    if (msg.inReplyTo) headers['In-Reply-To'] = msg.inReplyTo
    if (msg.references?.length) headers['References'] = msg.references.join(' ')

    let res: Response
    try {
      res = await fetch(`${API}/emails`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          from: fmt(msg.from),
          to: msg.to.map(fmt),
          ...(msg.cc?.length ? { cc: msg.cc.map(fmt) } : {}),
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          headers,
        }),
      })
    } catch (cause) {
      throw new EmailSendError(
        `Could not reach Resend: ${cause instanceof Error ? cause.message : String(cause)}`,
        true,
      )
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      // 401/403 means the key is wrong, 422 means the sender domain is not
      // verified — neither is worth retrying, both need an administrator.
      throw new EmailSendError(`Resend rejected the message (HTTP ${res.status}): ${detail}`, res.status >= 500)
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return { providerMessageId: body.id ?? msg.messageId }
  }

  async testConnection(): Promise<TestResult> {
    if (!this.apiKey) return { ok: false, detail: 'No API key is configured for this provider.' }
    try {
      // Listing domains is the cheapest authenticated call that proves the key
      // works without sending anything to anybody.
      const res = await fetch(`${API}/domains`, { headers: this.headers() })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: 'Resend rejected the API key (401/403). Check the key and its permissions.' }
      }
      if (!res.ok) return { ok: false, detail: `Resend answered HTTP ${res.status}.` }
      const body = (await res.json().catch(() => ({}))) as { data?: { name?: string; status?: string }[] }
      const domains = (body.data ?? []).map((d) => `${d.name} (${d.status})`).join(', ')
      return {
        ok: true,
        detail: domains
          ? `Connected to Resend. Verified domains: ${domains}`
          : 'Connected to Resend, but no sending domains are set up yet — add and verify one before sending.',
      }
    } catch (cause) {
      return { ok: false, detail: `Could not reach Resend: ${cause instanceof Error ? cause.message : String(cause)}` }
    }
  }
}

export const resendDefinition: ProviderDefinition = {
  type: 'resend',
  label: 'Resend',
  description: 'Transactional email API. The sending domain must be verified in Resend before mail will go out.',
  credentialFields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'password',
      required: true,
      placeholder: 're_xxxxxxxxxxxx',
      help: 'Create one under API Keys in the Resend dashboard, with sending permission.',
    },
  ],
  create: ({ credentials }) => new ResendProvider(credentials.apiKey ?? ''),
}
