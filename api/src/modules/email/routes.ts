import { Hono } from 'hono'
import type { AppEnv } from '@/http/ctx.ts'
import { ok, created } from '@/http/respond.ts'
import { BadRequest, Unauthorized } from '@/http/errors.ts'
import { rateLimit } from '@/middleware/common.ts'
import { fromMime, fromProviderFields } from './inbound/normalize.ts'
import { ingest, type IngestOutcome } from './inbound/pipeline.ts'

/**
 * Inbound email.
 *
 * These routes are NOT behind the bearer-token middleware — the sender is a
 * mail server, not an agent. They are protected by a shared secret instead,
 * and rate limited, because the URL is reachable by anyone who learns it.
 */
export const emailRoutes = new Hono<AppEnv>()

/** Constant-time-ish comparison so the secret cannot be guessed by timing. */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

function assertSecret(c: { req: { header: (k: string) => string | undefined }; get: (k: 'config') => { inboundSecret: string } }) {
  const expected = c.get('config').inboundSecret
  if (!expected) {
    throw new BadRequest(
      'INBOUND_WEBHOOK_SECRET is not set, so inbound mail cannot be authenticated. Generate one and put it in .env.',
    )
  }
  const provided = c.req.header('x-inbound-secret') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!secretMatches(provided, expected)) throw new Unauthorized('Invalid inbound secret')
}

/** Same HTTP shape for every outcome, so a sender can be configured once. */
function respond(c: Parameters<typeof ok>[0], outcome: IngestOutcome) {
  // 2xx on duplicate and ignored is deliberate: a non-2xx makes the provider
  // retry, and retrying a message we already handled helps nobody.
  if (outcome.status === 'created' || outcome.status === 'appended') return created(c, outcome)
  return ok(c, outcome)
}

/**
 * Raw MIME. This is what a Cloudflare Email Worker forwards, and what a local
 * tunnel or `curl --data-binary @file.eml` can post for testing.
 */
emailRoutes.post(
  '/inbound/mime',
  rateLimit({ name: 'inbound-mime', limit: 300, windowSeconds: 60 }),
  async (c) => {
    assertSecret(c as never)
    const raw = await c.req.arrayBuffer()
    if (!raw.byteLength) throw new BadRequest('Empty message body')

    const email = await fromMime(raw)
    const outcome = await ingest({
      email,
      source: 'email_worker',
      providerEventId: c.req.header('x-message-id') ?? email.messageId,
    })
    return respond(c, outcome)
  },
)

/**
 * Provider webhooks (SendGrid Inbound Parse, Mailgun Routes).
 *
 * They POST multipart/form-data with the message already parsed. The provider
 * name is part of the dedupe key, so the same message arriving through two
 * providers is still deduped by Message-ID.
 */
emailRoutes.post(
  '/inbound/:provider{[a-z0-9_-]+}',
  rateLimit({ name: 'inbound-webhook', limit: 300, windowSeconds: 60 }),
  async (c) => {
    assertSecret(c as never)
    const provider = c.req.param('provider')

    let fields: Record<string, string>
    const contentType = c.req.header('content-type') ?? ''
    if (contentType.includes('json')) {
      fields = (await c.req.json()) as Record<string, string>
    } else {
      const body = await c.req.parseBody()
      fields = Object.fromEntries(
        Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : '']),
      )
    }

    // Some providers post the full MIME alongside the parsed fields; prefer it,
    // because it carries the headers threading depends on.
    const email = fields.email
      ? await fromMime(fields.email)
      : fromProviderFields(fields)

    const outcome = await ingest({
      email,
      source: `webhook:${provider}`,
      providerEventId: fields['Message-Id'] ?? fields['message-id'] ?? email.messageId,
    })
    return respond(c, outcome)
  },
)

/**
 * Development only: upload a .eml file and run the identical pipeline.
 *
 * You cannot receive real mail on localhost, and a pipeline you can only test
 * in production is a pipeline nobody tests.
 */
emailRoutes.post('/inbound-dev/eml', async (c) => {
  if (c.get('config').isProduction) throw new Unauthorized('Not available in production')
  const raw = await c.req.arrayBuffer()
  if (!raw.byteLength) throw new BadRequest('Post a .eml file as the request body')

  const email = await fromMime(raw)
  const outcome = await ingest({ email, source: 'dev', providerEventId: null })
  return respond(c, outcome)
})
