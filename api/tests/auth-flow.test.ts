import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Integration tests against a real database.
 *
 * SQLite makes this cheap: a temp file, the real migrations, the real seed and
 * the real app — no server to stand up. These cover the auth flow end to end,
 * including the concurrency case that logged everyone out.
 */

const dir = mkdtempSync(join(tmpdir(), 'sp-test-'))
const dbFile = join(dir, 'test.db')

const env = {
  ...process.env,
  DB_FILE: dbFile,
  JWT_SECRET: 'test-secret-long-enough-for-the-validator-0123456789',
  SEED_ADMIN_EMAIL: 'tester@example.com',
  SEED_ADMIN_PASSWORD: 'TestPassword!2026',
  NODE_ENV: 'test',
}

let app: { fetch: (req: Request) => Response | Promise<Response> }

beforeAll(async () => {
  execFileSync('npx', ['tsx', 'scripts/migrate.ts'], { env, stdio: 'pipe' })
  execFileSync('npx', ['tsx', 'scripts/seed.ts'], { env, stdio: 'pipe' })

  const { createApp } = await import('../src/app.ts')
  const { createNodeDb } = await import('../src/db/sqlite.ts')
  const { setDefaultDb } = await import('../src/db/index.ts')
  const { buildConfig } = await import('../src/config/index.ts')

  setDefaultDb(createNodeDb(buildConfig(env as never)))
  app = createApp(env as never)
}, 120_000)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** res.json() is `unknown`; every assertion here reads a known envelope. */
type Envelope = { success: boolean; data: any; error?: any; requestId?: string }
const json = async (res: Response): Promise<Envelope> => (await res.json()) as Envelope

const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve(app.fetch(
    new Request(`http://test${path}`, {
      method: 'POST',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  ))

const get = (path: string, headers: Record<string, string> = {}) =>
  Promise.resolve(app.fetch(new Request(`http://test${path}`, { headers })))

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? ''
  return raw.split(';')[0] ?? ''
}

async function signIn() {
  const res = await post('/api/v1/auth/login', {
    email: 'tester@example.com',
    password: 'TestPassword!2026',
  })
  const body = await json(res)
  return { token: body.data.accessToken as string, cookie: cookieFrom(res), status: res.status }
}

describe('login', () => {
  it('accepts the seeded administrator', async () => {
    const { status, token, cookie } = await signIn()
    expect(status).toBe(200)
    expect(token.split('.')).toHaveLength(3)
    expect(cookie).toContain('sp_refresh=')
  })

  it('rejects a wrong password with the same message as an unknown address', async () => {
    const wrong = await post('/api/v1/auth/login', { email: 'tester@example.com', password: 'nope' })
    const unknown = await post('/api/v1/auth/login', { email: 'nobody@example.com', password: 'nope' })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect((await json(wrong)).error.message).toBe((await json(unknown)).error.message)
  })

  it('returns validation errors in the envelope, not raw zod', async () => {
    const res = await post('/api/v1/auth/login', { email: 'not-an-email', password: '' })
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details.email).toBeTruthy()
    expect(body.requestId).toBeTruthy()
  })
})

describe('refresh rotation', () => {
  it('issues a new token and rotates the cookie', async () => {
    const { cookie } = await signIn()
    const res = await post('/api/v1/auth/refresh', undefined, { cookie })
    expect(res.status).toBe(200)
    expect(cookieFrom(res)).not.toBe(cookie)
  })

  /**
   * The bug this covers: two tabs, a retried request, or React's double-invoked
   * effects send the same cookie twice. Strict reuse-detection called that
   * theft and revoked every session, logging the user out everywhere.
   */
  it('survives two concurrent refreshes with the same cookie', async () => {
    const { cookie } = await signIn()

    const [a, b] = await Promise.all([
      post('/api/v1/auth/refresh', undefined, { cookie }),
      post('/api/v1/auth/refresh', undefined, { cookie }),
    ])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)

    // Critically, the session still works afterwards.
    const latest = cookieFrom(b) || cookieFrom(a)
    const after = await post('/api/v1/auth/refresh', undefined, { cookie: latest })
    expect(after.status).toBe(200)
  })

  it('refuses a refresh with no cookie at all', async () => {
    const res = await post('/api/v1/auth/refresh')
    expect(res.status).toBe(401)
  })

  it('kills every session when a long-revoked token is replayed', async () => {
    const { cookie } = await signIn()
    await post('/api/v1/auth/refresh', undefined, { cookie })

    // Age the revocation past the grace window.
    const Database = (await import('better-sqlite3')).default
    const db = new Database(dbFile)
    db.prepare("UPDATE sp_refresh_tokens SET revoked_at = datetime('now', '-10 minutes') WHERE revoked_at IS NOT NULL").run()
    db.close()

    const replay = await post('/api/v1/auth/refresh', undefined, { cookie })
    expect(replay.status).toBe(401)
  })
})

describe('authenticated access', () => {
  it('rejects a request with no token', async () => {
    expect((await get('/api/v1/products')).status).toBe(401)
  })

  it('returns the actor with their products and permissions', async () => {
    const { token } = await signIn()
    const res = await get('/api/v1/auth/me', { authorization: `Bearer ${token}` })
    expect(res.status).toBe(200)
    const me = (await json(res)).data
    expect(me.email).toBe('tester@example.com')
    // The seeded admin holds a global grant, so every seeded product is visible.
    expect(me.accessibleProductIds.length).toBeGreaterThan(0)
    expect(me.permissions).toContain('ticket.view.all')
  })

  it('serves the ticket vocabulary with its semantic flags intact', async () => {
    const { token } = await signIn()
    const res = await get('/api/v1/tickets/meta', { authorization: `Bearer ${token}` })
    const meta = (await json(res)).data
    const open = meta.statuses.find((s: { code: string }) => s.code === 'open')
    const resolved = meta.statuses.find((s: { code: string }) => s.code === 'resolved')
    const pending = meta.statuses.find((s: { code: string }) => s.code === 'pending')
    expect(open.isOpen).toBe(true)
    expect(resolved.isResolved).toBe(true)
    // "Pending" means waiting on the customer, so the SLA clock stops.
    expect(pending.pausesSla).toBe(true)
  })
})

describe('tickets', () => {
  it('creates a ticket, numbers it from the product prefix, and threads a reply', async () => {
    const { token } = await signIn()
    const auth = { authorization: `Bearer ${token}` }

    const products = (await json(await get('/api/v1/products', auth))).data
    const erp = products.find((p: { code: string }) => p.code === 'charity_erp')

    const created = await post(
      '/api/v1/tickets',
      {
        productId: erp.id,
        customer: { name: 'Ada Lovelace', email: 'ada@example.org' },
        subject: 'Receipts are not generating',
        description: 'First paragraph.\n\nSecond paragraph.',
        priorityCode: 'urgent',
      },
      auth,
    )
    expect(created.status).toBe(201)
    const ticket = (await json(created)).data

    expect(ticket.number).toMatch(new RegExp(`^${erp.ticketPrefix}-\\d+$`))
    expect(ticket.messages).toHaveLength(1)
    // Blank-line separated blocks become separate paragraphs.
    expect(ticket.messages[0].bodyHtml.match(/<p>/g)).toHaveLength(2)
    // An agent-raised ticket has had no customer-facing reply yet.
    expect(ticket.firstRespondedAt).toBeNull()

    const replied = await post(`/api/v1/tickets/${ticket.id}/reply`, { body: 'On it.' }, auth)
    expect(replied.status).toBe(201)
    const afterReply = (await json(replied)).data
    expect(afterReply.messages).toHaveLength(2)
    expect(afterReply.firstRespondedAt).not.toBeNull()

    const noted = await post(`/api/v1/tickets/${ticket.id}/notes`, { body: 'Internal only.' }, auth)
    const afterNote = (await json(noted)).data
    const note = afterNote.messages.at(-1)!
    expect(note.visibility).toBe('private')
    expect(note.type).toBe('note')
  })

  it('returns 404 — not 403 — for a ticket that does not exist', async () => {
    const { token } = await signIn()
    const res = await get('/api/v1/tickets/999999', { authorization: `Bearer ${token}` })
    expect(res.status).toBe(404)
  })

  it('gives the list and the detail endpoint the same row shape', async () => {
    const { token } = await signIn()
    const auth = { authorization: `Bearer ${token}` }

    const list = (await json(await get('/api/v1/tickets?perPage=1', auth))).data
    expect(list.length).toBeGreaterThan(0)
    const detail = (await json(await get(`/api/v1/tickets/${list[0].id}`, auth))).data

    // Drifting shapes here is what broke the UI: the list was camelCase and the
    // detail was leaking snake_case column names.
    for (const key of ['number', 'productId', 'statusCode', 'priorityCode', 'createdAt', 'frDueAt', 'tags', 'product', 'customer']) {
      expect(detail[key], `detail is missing ${key}`).toBeDefined()
    }
  })
})
