import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mailpitDefinition } from '../src/modules/email/providers/mailpit.ts'
import { createProvider, isKnownProviderType, providerCatalogue } from '../src/modules/email/providers/registry.ts'
import { EmailSendError, type OutboundMessage } from '../src/modules/email/providers/types.ts'

const baseMessage: OutboundMessage = {
  from: { name: 'Charity ERP Support', address: 'support@charityerp.com' },
  to: [{ name: 'Eleanor', address: 'eleanor@example.org' }],
  subject: 'Gift Aid claim [#ERP-4]',
  html: '<p>Fixed.</p>',
  text: 'Fixed.',
  messageId: '<t14.m5.abc@incomingmail.charityerp.com>',
  inReplyTo: '<customer-002@mail.example.org>',
  references: ['<customer-001@mail.example.org>', '<customer-002@mail.example.org>'],
}

const provider = () => mailpitDefinition.create({ credentials: { baseUrl: 'http://mailpit.test:8025' }, config: {} })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mailpit provider', () => {
  it('sends the threading headers the reply chain depends on', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ ID: 'mp-123' }), { status: 200 })
    })

    const result = await provider().send(baseMessage)

    expect(result.providerMessageId).toBe('mp-123')
    expect(calls[0]!.url).toBe('http://mailpit.test:8025/api/v1/send')

    const headers = calls[0]!.body.Headers as Record<string, string>
    // Without our own Message-ID, Mailpit mints one and the customer's reply
    // can no longer be matched back to the ticket.
    expect(headers['Message-ID']).toBe(baseMessage.messageId)
    expect(headers['In-Reply-To']).toBe(baseMessage.inReplyTo)
    // References is space separated on the wire, not comma separated.
    expect(headers['References']).toBe(baseMessage.references!.join(' '))
  })

  it('omits threading headers on a brand new thread rather than sending empty ones', async () => {
    let sent: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ ID: 'mp-1' }), { status: 200 })
    })

    await provider().send({ ...baseMessage, inReplyTo: null, references: [] })

    const headers = sent.Headers as Record<string, string>
    expect(headers['Message-ID']).toBeTruthy()
    expect(headers).not.toHaveProperty('In-Reply-To')
    expect(headers).not.toHaveProperty('References')
  })

  it('falls back to our own message id when the provider returns no id', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
    // provider_message_id must never be null on a successful send.
    await expect(provider().send(baseMessage)).resolves.toEqual({
      providerMessageId: baseMessage.messageId,
    })
  })

  it('explains an unreachable Mailpit instead of surfacing "fetch failed"', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })

    const err = await provider().send(baseMessage).catch((e) => e)
    expect(err).toBeInstanceOf(EmailSendError)
    expect(err.message).toContain('mailpit.test:8025')
    // An agent reading this on the timeline needs to know what to do.
    expect(err.message).toMatch(/start it with/i)
    expect(err.retryable).toBe(true)
  })

  it('treats 5xx as retryable and 4xx as not', async () => {
    vi.stubGlobal('fetch', async () => new Response('upstream down', { status: 503 }))
    await expect(provider().send(baseMessage)).rejects.toMatchObject({ retryable: true })

    vi.stubGlobal('fetch', async () => new Response('bad address', { status: 400 }))
    await expect(provider().send(baseMessage)).rejects.toMatchObject({ retryable: false })
  })

  it('sends basic auth only when a username is configured', async () => {
    const seen: (string | undefined)[] = []
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>).authorization)
      return new Response(JSON.stringify({ ID: 'x' }), { status: 200 })
    })

    await mailpitDefinition
      .create({ credentials: { baseUrl: 'http://m.test' }, config: {} })
      .send(baseMessage)
    await mailpitDefinition
      .create({ credentials: { baseUrl: 'http://m.test', username: 'u', password: 'p' }, config: {} })
      .send(baseMessage)

    expect(seen[0]).toBeUndefined()
    expect(seen[1]).toBe(`Basic ${btoa('u:p')}`)
  })

  it('reports a real round trip from testConnection', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ Version: 'v1.30.5', Messages: 3 }), { status: 200 }))
    await expect(provider().testConnection()).resolves.toMatchObject({ ok: true })

    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    const failed = await provider().testConnection()
    expect(failed.ok).toBe(false)
    expect(failed.detail).toContain('mailpit.test:8025')
  })

  it('defaults to Mailpit’s documented local address', async () => {
    let url = ''
    vi.stubGlobal('fetch', async (u: string) => {
      url = String(u)
      return new Response(JSON.stringify({ Version: 'v1' }), { status: 200 })
    })
    await mailpitDefinition.create({ credentials: {}, config: {} }).testConnection()
    expect(url).toBe('http://127.0.0.1:8025/api/v1/info')
  })
})

describe('provider registry', () => {
  it('knows mailpit and publishes its credential fields', () => {
    expect(isKnownProviderType('mailpit')).toBe(true)
    const entry = providerCatalogue().find((p) => p.type === 'mailpit')
    // The admin form is generated from these, so an empty list means an
    // unfillable form.
    expect(entry?.credentialFields.map((f) => f.key)).toEqual(['baseUrl', 'username', 'password'])
  })

  it('refuses an unregistered type loudly rather than dropping the mail', () => {
    expect(isKnownProviderType('sendgrid')).toBe(false)
    expect(() => createProvider('sendgrid', { credentials: {}, config: {} })).toThrow(/No provider is registered/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Integration: a reply must survive a provider that cannot send.
// ───────────────────────────────────────────────────────────────────────────

/** res.json() is `unknown`; every assertion here reads a known envelope. */
type Envelope = { success: boolean; data: any; error?: any }
const json = async (res: Response): Promise<Envelope> => (await res.json()) as Envelope

describe('reply delivery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-outbound-'))
  const dbFile = join(dir, 'test.db')
  const env = {
    ...process.env,
    DB_FILE: dbFile,
    JWT_SECRET: 'test-secret-long-enough-for-the-validator-0123456789',
    CREDENTIALS_MASTER_KEY: 'TRhWqkYQ0lG0kqfu1X9mJ0oJ0NtxLk1M8K0yC3Zp7mE=',
    SEED_ADMIN_EMAIL: 'tester@example.com',
    SEED_ADMIN_PASSWORD: 'TestPassword!2026',
    DEFAULT_EMAIL_PROVIDER_TYPE: 'mailpit',
    DEFAULT_EMAIL_PROVIDER_SENDER_EMAIL: 'support@charityerp.com',
    DEFAULT_EMAIL_PROVIDER_SENDER_NAME: 'Support',
    MAILPIT_BASE_URL: 'http://mailpit.invalid:8025',
    NODE_ENV: 'test',
  }

  let token = ''
  let app: { fetch: (req: Request) => Response | Promise<Response> }
  let ticketId = 0

  beforeAll(async () => {
    execFileSync('npx', ['tsx', 'scripts/migrate.ts'], { env, stdio: 'pipe' })
    execFileSync('npx', ['tsx', 'scripts/seed.ts'], { env, stdio: 'pipe' })

    const { createApp } = await import('../src/app.ts')
    const { createNodeDb } = await import('../src/db/sqlite.ts')
    const { setDefaultDb } = await import('../src/db/index.ts')
    const { buildConfig } = await import('../src/config/index.ts')

    setDefaultDb(createNodeDb(buildConfig(env as never)))
    app = createApp(env as never)

    const login = await app.fetch(
      new Request('http://x/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'tester@example.com', password: 'TestPassword!2026' }),
      }),
    )
    token = (await json(login)).data.accessToken

    const products = await app.fetch(
      new Request('http://x/api/v1/products', { headers: { authorization: `Bearer ${token}` } }),
    )
    const productId = (await json(products)).data[0].id

    const createTicket = await app.fetch(
      new Request('http://x/api/v1/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          productId,
          subject: 'Delivery failure handling',
          description: 'Please confirm.',
          customer: { name: 'Test Customer', email: 'customer@example.org' },
          source: 'manual',
        }),
      }),
    )
    const createdBody = await json(createTicket)
    if (!createdBody.success) throw new Error(`ticket create failed: ${JSON.stringify(createdBody)}`)
    ticketId = createdBody.data.id
  }, 180_000)

  const reply = (body: string, path = 'reply') =>
    app.fetch(
      new Request(`http://x/api/v1/tickets/${ticketId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ body }),
      }),
    )

  it('seeds the bootstrap provider as the global default', async () => {
    const res = await app.fetch(
      new Request('http://x/api/v1/settings/email-providers', { headers: { authorization: `Bearer ${token}` } }),
    )
    const providers = (await json(res)).data as { type: string; isGlobalDefault: boolean; source: string }[]
    const mailpit = providers.find((p) => p.type === 'mailpit')
    expect(mailpit?.isGlobalDefault).toBe(true)
    expect(mailpit?.source).toBe('bootstrap')
  })

  it('stores the reply and records the failure when the provider is unreachable', async () => {
    const res = await reply('This must be saved even though sending fails.')
    // The agent's request SUCCEEDS: their words are committed. Delivery is a
    // separate fact recorded on the message.
    expect(res.status).toBe(201)

    const detail = (await json(res)).data
    const last = detail.messages[detail.messages.length - 1]
    expect(last.bodyHtml).toContain('must be saved')
    expect(last.deliveryStatus).toBe('failed')
    expect(last.deliveryDetail).toMatch(/mailpit\.invalid/)
  })

  it('never mails a private note', async () => {
    const res = await reply('Internal: customer is on the enterprise plan.', 'notes')
    expect(res.status).toBe(201)

    const detail = (await json(res)).data
    const note = detail.messages[detail.messages.length - 1]
    expect(note.visibility).toBe('private')
    // No Message-ID, no delivery attempt, nothing that could leave the system.
    expect(note.deliveryStatus).toBeNull()
  })
})
