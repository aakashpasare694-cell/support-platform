import type { Addressee, EmailProvider, OutboundMessage, ProviderDefinition, TestResult } from './types.ts'
import { EmailSendError } from './types.ts'

/**
 * Mailpit — the local development provider.
 *
 * Mailpit is an SMTP sink with a web UI, so nothing it accepts ever reaches a
 * real person. That makes it the right default for local and CI: the whole
 * outbound path runs for real, and the result is readable at
 * http://localhost:8025 instead of in someone's inbox.
 *
 * It is driven over Mailpit's HTTP API (`POST /api/v1/send`), NOT over SMTP.
 * SMTP needs a raw TCP socket, which Cloudflare Workers cannot open — so an
 * SMTP adapter would run on Node only and the two runtimes would stop being
 * the same code path. The HTTP API is plain `fetch`, so this file runs
 * unchanged in both. (Requires Mailpit >= 1.14, which added the send endpoint.)
 *
 * Verified against Mailpit v1.30.5: custom `Message-ID`, `In-Reply-To` and
 * `References` headers survive the round trip, which is what ticket threading
 * depends on.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8025'

interface MailpitAddress {
  Email: string
  Name?: string
}

const toMailpit = (a: Addressee): MailpitAddress =>
  a.name ? { Email: a.address, Name: a.name } : { Email: a.address }

function basicAuthHeader(username: string, password: string): string {
  // btoa is available on both Workers and Node 22 — no Buffer, which keeps
  // this file runtime-neutral.
  return `Basic ${btoa(`${username}:${password}`)}`
}

class MailpitProvider implements EmailProvider {
  readonly type = 'mailpit'

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    // Only when Mailpit was started with --ui-auth; unauthenticated is the
    // normal local case.
    if (this.username) h.authorization = basicAuthHeader(this.username, this.password)
    return h
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`
  }

  async send(msg: OutboundMessage) {
    // Threading headers are passed through verbatim. Mailpit mints its own
    // Message-ID when none is given, which would break the reply chain, so
    // ours is always sent explicitly.
    const headers: Record<string, string> = { 'Message-ID': msg.messageId }
    if (msg.inReplyTo) headers['In-Reply-To'] = msg.inReplyTo
    if (msg.references?.length) headers['References'] = msg.references.join(' ')

    const payload = {
      From: toMailpit(msg.from),
      To: msg.to.map(toMailpit),
      ...(msg.cc?.length ? { Cc: msg.cc.map(toMailpit) } : {}),
      ...(msg.replyTo ? { ReplyTo: [{ Email: msg.replyTo }] } : {}),
      Subject: msg.subject,
      Text: msg.text,
      HTML: msg.html,
      Headers: headers,
    }

    let res: Response
    try {
      res = await fetch(this.url('/api/v1/send'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
      })
    } catch (cause) {
      // Mailpit not running is the overwhelmingly common cause, and the error
      // should say so rather than leaving an agent staring at "fetch failed".
      throw new EmailSendError(
        `Could not reach Mailpit at ${this.baseUrl}. Start it with: mailpit (SMTP 1025, UI 8025). Cause: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        true,
      )
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      throw new EmailSendError(
        `Mailpit rejected the message (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
        // 5xx is worth retrying; a 4xx means the message itself is wrong.
        res.status >= 500,
      )
    }

    const body = (await res.json().catch(() => ({}))) as { ID?: string }
    // Fall back to our own id so provider_message_id is never null on success.
    return { providerMessageId: body.ID ?? msg.messageId }
  }

  async testConnection(): Promise<TestResult> {
    try {
      const res = await fetch(this.url('/api/v1/info'), { headers: this.headers() })
      if (!res.ok) {
        return { ok: false, detail: `Mailpit answered HTTP ${res.status} at ${this.baseUrl}` }
      }
      const info = (await res.json()) as { Version?: string; Messages?: number }
      return {
        ok: true,
        detail: `Connected to Mailpit ${info.Version ?? '(unknown version)'} at ${this.baseUrl}; ${
          info.Messages ?? 0
        } message(s) in the inbox.`,
      }
    } catch (cause) {
      return {
        ok: false,
        detail: `Could not reach Mailpit at ${this.baseUrl}. Is it running? Cause: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      }
    }
  }
}

export const mailpitDefinition: ProviderDefinition = {
  type: 'mailpit',
  label: 'Mailpit (local testing)',
  description:
    'Captures every outgoing email locally instead of delivering it. Nothing reaches a real recipient — read what was sent at http://localhost:8025.',
  credentialFields: [
    {
      key: 'baseUrl',
      label: 'Mailpit HTTP URL',
      type: 'url',
      required: false,
      placeholder: DEFAULT_BASE_URL,
      help: 'The web UI address, not the SMTP port. Defaults to http://127.0.0.1:8025.',
    },
    {
      key: 'username',
      label: 'UI username',
      type: 'text',
      required: false,
      help: 'Only if Mailpit was started with --ui-auth. Leave blank otherwise.',
    },
    { key: 'password', label: 'UI password', type: 'password', required: false },
  ],
  create: ({ credentials, config }) => {
    // The URL may sit in either place: credentials when an admin typed it into
    // the form, config when it came from the bootstrap secrets.
    const baseUrl =
      credentials.baseUrl || (typeof config.baseUrl === 'string' ? config.baseUrl : '') || DEFAULT_BASE_URL
    return new MailpitProvider(baseUrl, credentials.username ?? '', credentials.password ?? '')
  },
}
