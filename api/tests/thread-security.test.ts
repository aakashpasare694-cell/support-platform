import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Threading must require BOTH an email marker and a requester check.
 *
 * Ticket numbers are sequential and travel in plain text in every subject
 * line, so a marker on its own proves nothing about who sent the message.
 * Without the requester check, anyone could append to any ticket by writing
 * "[#CRM-4]" in the subject — and an agent reading the thread would see the
 * injected text inline, attributed to the conversation.
 */

const dir = mkdtempSync(join(tmpdir(), 'sp-thread-sec-'))
const dbFile = join(dir, 'test.db')
const env = {
  ...process.env,
  DB_FILE: dbFile,
  JWT_SECRET: 'test-secret-long-enough-for-the-validator-0123456789',
  INBOUND_WEBHOOK_SECRET: 'test-inbound-secret-0123456789abcdef',
  SEED_ADMIN_EMAIL: 'agent@support.local',
  SEED_ADMIN_PASSWORD: 'TestPassword!2026',
  DEFAULT_EMAIL_PROVIDER_TYPE: '',
  NODE_ENV: 'test',
}

let app: { fetch: (req: Request) => Response | Promise<Response> }
let inboundAddress = ''
let ticketNumber = ''

const eml = (from: string, subject: string, extra = '') =>
  `From: ${from}\nTo: ${inboundAddress}\nSubject: ${subject}\n` +
  `Message-ID: <${Math.random().toString(36).slice(2)}@test.invalid>\n${extra}` +
  `Date: Sun, 16 Nov 2026 12:00:00 +0530\nContent-Type: text/plain; charset=utf-8\n\nBody text.\n`

async function ingest(raw: string) {
  const res = await app.fetch(
    new Request('http://x/webhooks/email/inbound/mime', {
      method: 'POST',
      headers: {
        'content-type': 'message/rfc822',
        'x-inbound-secret': env.INBOUND_WEBHOOK_SECRET,
        'x-message-id': Math.random().toString(36).slice(2),
      },
      body: raw,
    }),
  )
  return (await res.json()) as { data: { status: string; ticketNumber?: string; ticketId?: number } }
}

beforeAll(async () => {
  execFileSync('npx', ['tsx', 'scripts/migrate.ts'], { env, stdio: 'pipe' })
  execFileSync('npx', ['tsx', 'scripts/seed.ts'], { env, stdio: 'pipe' })

  const { createApp } = await import('../src/app.ts')
  const { createNodeDb } = await import('../src/db/sqlite.ts')
  const { setDefaultDb, db } = await import('../src/db/index.ts')
  const { buildConfig } = await import('../src/config/index.ts')

  setDefaultDb(createNodeDb(buildConfig(env as never)))
  app = createApp(env as never)

  const addr = await db().selectFrom('sp_inbound_addresses').select(['address']).executeTakeFirstOrThrow()
  inboundAddress = addr.address

  // The original customer opens a ticket.
  const first = await ingest(eml('Real Customer <customer@example.org>', 'Export is failing'))
  expect(first.data.status).toBe('created')
  ticketNumber = first.data.ticketNumber!
}, 180_000)

describe('requester check', () => {
  it('lets the ticket’s own customer thread on the subject token', async () => {
    const out = await ingest(eml('Real Customer <customer@example.org>', `Re: Export is failing [#${ticketNumber}]`))
    expect(out.data.status).toBe('appended')
    expect(out.data.ticketNumber).toBe(ticketNumber)
  })

  it('refuses a stranger who merely guessed the ticket token', async () => {
    const out = await ingest(eml('Attacker <stranger@attacker.test>', `Re: Export is failing [#${ticketNumber}]`))
    // A NEW ticket, not an append — the message is kept, just not injected
    // into someone else's conversation.
    expect(out.data.status).toBe('created')
    expect(out.data.ticketNumber).not.toBe(ticketNumber)
  })

  it('refuses a stranger forging In-Reply-To against a real stored Message-ID', async () => {
    const { db } = await import('../src/db/index.ts')
    const stored = await db()
      .selectFrom('sp_ticket_messages as m')
      .innerJoin('sp_tickets as t', 't.id', 'm.ticket_id')
      .select(['m.message_id'])
      .where('t.ticket_number', '=', ticketNumber)
      .where('m.message_id', 'is not', null)
      .executeTakeFirst()

    // Only meaningful if there is a Message-ID to forge against.
    if (!stored?.message_id) return

    const out = await ingest(
      eml('Attacker <stranger2@attacker.test>', 'Re: Export is failing', `In-Reply-To: ${stored.message_id}\n`),
    )
    expect(out.data.status).toBe('created')
    expect(out.data.ticketNumber).not.toBe(ticketNumber)
  })

  it('lets an agent reply by email', async () => {
    const out = await ingest(eml('Agent <agent@support.local>', `Re: Export is failing [#${ticketNumber}]`))
    expect(out.data.status).toBe('appended')
    expect(out.data.ticketNumber).toBe(ticketNumber)
  })

  it('lets someone already Cc’d on the thread reply', async () => {
    const { db } = await import('../src/db/index.ts')
    const ticket = await db()
      .selectFrom('sp_tickets')
      .select(['id'])
      .where('ticket_number', '=', ticketNumber)
      .executeTakeFirstOrThrow()

    // Put a colleague on the thread the way a real Cc would.
    await db()
      .updateTable('sp_ticket_messages')
      .set({ cc_json: JSON.stringify(['colleague@example.org']) })
      .where('ticket_id', '=', ticket.id)
      .execute()

    const out = await ingest(eml('Colleague <colleague@example.org>', `Re: Export is failing [#${ticketNumber}]`))
    expect(out.data.status).toBe('appended')
  })
})
