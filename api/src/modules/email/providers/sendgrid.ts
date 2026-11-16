import type { Addressee, EmailProvider, OutboundMessage, ProviderDefinition, TestResult } from './types.ts'
import { EmailSendError } from './types.ts'

/**
 * SendGrid Web API v3 — a production sending provider.
 *
 * Like Resend: HTTPS + Bearer token, so one code path for both runtimes.
 * Note SendGrid answers 202 (not 200) on success and returns the provider
 * message id in a header rather than a body.
 */

const API = 'https://api.sendgrid.com/v3'

const addr = (a: Addressee) => (a.name ? { email: a.address, name: a.name } : { email: a.address })

class SendGridProvider implements EmailProvider {
  readonly type = 'sendgrid'

  constructor(private readonly apiKey: string) {}

  private headers() {
    return { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }
  }

  async send(msg: OutboundMessage) {
    if (!this.apiKey) throw new EmailSendError('SendGrid API key is not configured.')

    const headers: Record<string, string> = { 'Message-ID': msg.messageId }
    if (msg.inReplyTo) headers['In-Reply-To'] = msg.inReplyTo
    if (msg.references?.length) headers['References'] = msg.references.join(' ')

    let res: Response
    try {
      res = await fetch(`${API}/mail/send`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          personalizations: [
            { to: msg.to.map(addr), ...(msg.cc?.length ? { cc: msg.cc.map(addr) } : {}) },
          ],
          from: addr(msg.from),
          ...(msg.replyTo ? { reply_to: { email: msg.replyTo } } : {}),
          subject: msg.subject,
          content: [
            // Order matters to SendGrid: text/plain must come first.
            { type: 'text/plain', value: msg.text || ' ' },
            { type: 'text/html', value: msg.html || '<p></p>' },
          ],
          headers,
        }),
      })
    } catch (cause) {
      throw new EmailSendError(
        `Could not reach SendGrid: ${cause instanceof Error ? cause.message : String(cause)}`,
        true,
      )
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      throw new EmailSendError(`SendGrid rejected the message (HTTP ${res.status}): ${detail}`, res.status >= 500)
    }

    // 202 Accepted with an empty body; the id travels in a header.
    return { providerMessageId: res.headers.get('x-message-id') ?? msg.messageId }
  }

  async testConnection(): Promise<TestResult> {
    if (!this.apiKey) return { ok: false, detail: 'No API key is configured for this provider.' }
    try {
      const res = await fetch(`${API}/scopes`, { headers: this.headers() })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: 'SendGrid rejected the API key (401/403). Check the key and its scopes.' }
      }
      if (!res.ok) return { ok: false, detail: `SendGrid answered HTTP ${res.status}.` }
      const body = (await res.json().catch(() => ({}))) as { scopes?: string[] }
      const canSend = (body.scopes ?? []).some((s) => s.startsWith('mail.send'))
      return {
        ok: canSend,
        detail: canSend
          ? 'Connected to SendGrid and the key has mail.send permission.'
          : 'Connected, but this key lacks the mail.send scope, so it cannot send mail.',
      }
    } catch (cause) {
      return { ok: false, detail: `Could not reach SendGrid: ${cause instanceof Error ? cause.message : String(cause)}` }
    }
  }
}

export const sendgridDefinition: ProviderDefinition = {
  type: 'sendgrid',
  label: 'SendGrid',
  description: 'Twilio SendGrid Web API v3. The sender address or domain must be verified in SendGrid.',
  credentialFields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'password',
      required: true,
      placeholder: 'SG.xxxxxxxx',
      help: 'Needs the Mail Send permission only.',
    },
  ],
  create: ({ credentials }) => new SendGridProvider(credentials.apiKey ?? ''),
}
