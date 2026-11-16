import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Roles are organisational, not product decisions.
 *
 * Only Super Admin and Admin ship by default — they exist so there is always a
 * way in. Everything else is created by an administrator, which means create
 * and delete have to be safe: a role cannot be deleted out from under the
 * agents holding it, and the built-in two cannot be removed at all.
 */

const dir = mkdtempSync(join(tmpdir(), 'sp-roles-'))
const env = {
  ...process.env,
  DB_FILE: join(dir, 'test.db'),
  JWT_SECRET: 'test-secret-long-enough-for-the-validator-0123456789',
  SEED_ADMIN_EMAIL: 'admin@test.local',
  SEED_ADMIN_PASSWORD: 'TestPassword!2026',
  DEFAULT_EMAIL_PROVIDER_TYPE: '',
  NODE_ENV: 'test',
}

let app: { fetch: (req: Request) => Response | Promise<Response> }
let token = ''

type Envelope = { success: boolean; data: any; error?: { message: string } }
const json = async (r: Response) => (await r.json()) as Envelope

const call = (method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://x/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )

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
      body: JSON.stringify({ email: 'admin@test.local', password: 'TestPassword!2026' }),
    }),
  )
  token = (await json(login)).data.accessToken
}, 180_000)

describe('default roles', () => {
  it('ships exactly Super Admin and Admin, both built in', async () => {
    const { data } = await json(await call('GET', '/roles'))
    const roles = data.roles as { code: string; isSystem: boolean }[]
    expect(roles.map((r) => r.code).sort()).toEqual(['admin', 'super_admin'])
    expect(roles.every((r) => r.isSystem)).toBe(true)
  })
})

describe('creating roles', () => {
  it('creates one and derives a url-safe code from the name', async () => {
    const { data } = await json(await call('POST', '/roles', { name: 'Support Manager', permissionCodes: ['ticket.reply'] }))
    expect(data.code).toBe('support_manager')

    const after = await json(await call('GET', '/roles'))
    const made = (after.data.roles as any[]).find((r) => r.code === 'support_manager')
    expect(made.isSystem).toBe(false)
    expect(made.permissionCodes).toEqual(['ticket.reply'])
  })

  it('does not collide when two roles share a name', async () => {
    const { data } = await json(await call('POST', '/roles', { name: 'Support Manager', permissionCodes: [] }))
    expect(data.code).toBe('support_manager_2')
  })

  it('refuses an unknown permission instead of silently dropping it', async () => {
    const res = await call('POST', '/roles', { name: 'Bad Role', permissionCodes: ['not.a.permission'] })
    expect(res.status).toBe(400)
    expect((await json(res)).error!.message).toMatch(/Unknown permission/)
  })
})

describe('deleting roles', () => {
  it('deletes a custom role', async () => {
    expect((await call('DELETE', '/roles/support_manager_2')).status).toBe(200)
    const { data } = await json(await call('GET', '/roles'))
    expect((data.roles as any[]).some((r) => r.code === 'support_manager_2')).toBe(false)
  })

  it('refuses to delete a built-in role', async () => {
    for (const code of ['super_admin', 'admin']) {
      const res = await call('DELETE', `/roles/${code}`)
      expect(res.status).toBe(400)
      expect((await json(res)).error!.message).toMatch(/built-in/)
    }
  })

  it('refuses while an agent still holds the role, and says how many', async () => {
    const { db } = await import('../src/db/index.ts')
    const role = await db().selectFrom('sp_roles').select(['id']).where('code', '=', 'support_manager').executeTakeFirstOrThrow()
    const user = await db().selectFrom('sp_users').select(['id']).executeTakeFirstOrThrow()
    await db().insertInto('sp_user_product_roles').values({ user_id: user.id, product_id: null, role_id: role.id }).execute()

    const res = await call('DELETE', '/roles/support_manager')
    expect(res.status).toBe(400)
    // Deleting it would strip their access with nothing in the UI to explain why.
    expect((await json(res)).error!.message).toMatch(/1 agent\(s\) still have/)
  })
})
