import { describe, expect, it } from 'vitest'
import {
  decryptSecret, encryptSecret, hashPassword, maskSecret, randomToken, sha256Hex, verifyPassword,
} from '../src/lib/crypto.ts'
import { signAccessToken, verifyAccessToken } from '../src/lib/jwt.ts'
import { can, scopeGroups, ticketScopeFor, visibleProductIds, type Actor } from '../src/http/ctx.ts'

const SECRET = 'test-secret-that-is-definitely-long-enough-32'
// openssl rand -base64 32
const MASTER_KEY = 'ZmFrZS1tYXN0ZXIta2V5LWZvci10ZXN0cy0zMmJ5dGU='

/**
 * PBKDF2 at 600k iterations costs ~1-2.5s per call BY DESIGN, and these tests
 * make two or three calls each. Vitest's default 5s timeout is enough on an
 * idle machine and not enough when the other suites are competing for CPU,
 * which made this file fail about one run in three. The cost is the feature,
 * so the timeout moves rather than the iteration count.
 */
const HASHING_TIMEOUT = 30_000

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  }, HASHING_TIMEOUT)

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
  }, HASHING_TIMEOUT)

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  }, HASHING_TIMEOUT)

  it('records its parameters, so iterations can be raised later without locking anyone out', async () => {
    const hash = await hashPassword('x')
    const [scheme, iterations] = hash.split('$')
    expect(scheme).toBe('pbkdf2')
    expect(Number(iterations)).toBeGreaterThanOrEqual(600_000)
  }, HASHING_TIMEOUT)

  it('treats a missing or malformed hash as a failure rather than throwing', async () => {
    expect(await verifyPassword('x', null)).toBe(false)
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt$12$abc$def')).toBe(false)
  }, HASHING_TIMEOUT)
})

describe('credential encryption', () => {
  it('round-trips a provider key', async () => {
    const payload = JSON.stringify({ apiKey: 'SG.p7Kd-live-key-value-3f2a' })
    const sealed = await encryptSecret(payload, MASTER_KEY)
    expect(sealed.startsWith('v1:')).toBe(true)
    expect(sealed).not.toContain('SG.p7Kd')
    expect(await decryptSecret(sealed, MASTER_KEY)).toBe(payload)
  })

  it('uses a fresh IV, so the same secret never produces the same ciphertext', async () => {
    const a = await encryptSecret('same', MASTER_KEY)
    const b = await encryptSecret('same', MASTER_KEY)
    expect(a).not.toBe(b)
  })

  it('refuses to decrypt with the wrong key', async () => {
    const sealed = await encryptSecret('secret', MASTER_KEY)
    const otherKey = 'b3RoZXIta2V5LWZvci10ZXN0cy0zMi1ieXRlcyEh'
    await expect(decryptSecret(sealed, otherKey)).rejects.toThrow()
  })

  it('rejects a master key that is not 32 bytes', async () => {
    await expect(encryptSecret('x', 'dG9vLXNob3J0')).rejects.toThrow(/32 bytes/)
  })

  it('masks a credential without revealing its middle', () => {
    const masked = maskSecret('SG.p7KdVeryLongLiveKey3f2a')
    expect(masked).not.toContain('VeryLongLiveKey')
    expect(masked.endsWith('3f2a')).toBe(true)
  })
})

describe('access tokens', () => {
  it('round-trips claims', async () => {
    const token = await signAccessToken({ sub: '42', email: 'a@b.co', name: 'Ada' }, SECRET, 900)
    const claims = await verifyAccessToken(token, SECRET)
    expect(claims.sub).toBe('42')
    expect(claims.email).toBe('a@b.co')
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken({ sub: '1', email: 'a@b.co', name: 'A' }, SECRET, 900)
    await expect(verifyAccessToken(token, 'a-completely-different-secret-value-32')).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const token = await signAccessToken({ sub: '1', email: 'a@b.co', name: 'A' }, SECRET, -10)
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow()
  })

  it('rejects a tampered payload', async () => {
    const token = await signAccessToken({ sub: '1', email: 'a@b.co', name: 'A' }, SECRET, 900)
    const [header, , signature] = token.split('.')
    const forged = btoa(JSON.stringify({ sub: '999', email: 'evil@x.co' })).replace(/=+$/, '')
    await expect(verifyAccessToken(`${header}.${forged}.${signature}`, SECRET)).rejects.toThrow()
  })
})

describe('opaque tokens', () => {
  it('produces url-safe, non-repeating values', () => {
    const a = randomToken()
    const b = randomToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThan(32)
  })

  it('hashes deterministically — only the hash is ever stored', async () => {
    expect(await sha256Hex('token')).toBe(await sha256Hex('token'))
    expect(await sha256Hex('token')).not.toBe(await sha256Hex('token2'))
  })
})

describe('permission resolution', () => {
  const actor = (over: Partial<Actor> = {}): Actor => ({
    id: 1,
    email: 'a@b.co',
    name: 'A',
    accessibleProductIds: [1, 3],
    isGlobal: false,
    globalPermissions: new Set<string>(),
    productPermissions: new Map(),
    teamIds: [],
    ...over,
  })

  it('a global grant applies to every product', () => {
    const a = actor({ isGlobal: true, globalPermissions: new Set(['ticket.reply']) })
    expect(can(a, 'ticket.reply', 1)).toBe(true)
    expect(can(a, 'ticket.reply', 99)).toBe(true)
  })

  it('a product grant does NOT leak to another product', () => {
    const a = actor({ productPermissions: new Map([[1, new Set(['ticket.reply'])]]) })
    expect(can(a, 'ticket.reply', 1)).toBe(true)
    // This is the check that keeps Pranic Healing invisible to a CRM agent.
    expect(can(a, 'ticket.reply', 2)).toBe(false)
  })

  it('without a product in scope, asks whether they could do it anywhere', () => {
    const a = actor({ productPermissions: new Map([[3, new Set(['report.view'])]]) })
    expect(can(a, 'report.view')).toBe(true)
    expect(can(a, 'ticket.delete')).toBe(false)
  })

  it('denies a permission nobody granted', () => {
    expect(can(actor(), 'ticket.delete', 1)).toBe(false)
  })
})

describe('ticket visibility scope', () => {
  const actor = (over: Partial<Actor> = {}): Actor => ({
    id: 7,
    email: 'a@b.co',
    name: 'A',
    accessibleProductIds: [1, 2, 3],
    isGlobal: false,
    globalPermissions: new Set<string>(),
    productPermissions: new Map(),
    teamIds: [],
    ...over,
  })

  it('takes the broadest scope the agent holds on a product', () => {
    const a = actor({
      productPermissions: new Map([
        [1, new Set(['ticket.view.assigned', 'ticket.view.all'])],
      ]),
    })
    expect(ticketScopeFor(a, 1)).toBe('all')
  })

  it('reports no scope on a product with no view permission', () => {
    const a = actor({ productPermissions: new Map([[1, new Set(['ticket.reply'])]]) })
    expect(ticketScopeFor(a, 1)).toBe('none')
  })

  it('resolves a DIFFERENT scope per product', () => {
    const a = actor({
      productPermissions: new Map([
        [1, new Set(['ticket.view.all'])],
        [2, new Set(['ticket.view.team'])],
        [3, new Set(['ticket.view.assigned'])],
      ]),
    })
    expect(scopeGroups(a)).toEqual({ all: [1], team: [2], assigned: [3] })
  })

  it('leaves out products the agent cannot see any tickets in', () => {
    const a = actor({
      accessibleProductIds: [1, 2],
      productPermissions: new Map([
        [1, new Set(['ticket.view.assigned'])],
        [2, new Set(['customer.view'])],
      ]),
    })
    expect(visibleProductIds(a)).toEqual([1])
    expect(scopeGroups(a).assigned).toEqual([1])
  })

  it('a global ticket.view.all covers every accessible product', () => {
    const a = actor({ isGlobal: true, globalPermissions: new Set(['ticket.view.all']) })
    expect(scopeGroups(a)).toEqual({ all: [1, 2, 3], team: [], assigned: [] })
  })

  it('an agent with nothing granted sees nothing', () => {
    expect(visibleProductIds(actor())).toEqual([])
    expect(scopeGroups(actor())).toEqual({ all: [], team: [], assigned: [] })
  })
})
