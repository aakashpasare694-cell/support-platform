import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '@/db/index.ts'
import { actorOf, type AppEnv, type Ctx } from '@/http/ctx.ts'
import { created, ok } from '@/http/respond.ts'
import { BadRequest, NotFound } from '@/http/errors.ts'
import { envelopeValidation } from '@/http/validate.ts'
import { requireAuth, requirePermission } from '@/middleware/auth.ts'
import { decryptSecret, encryptSecret, maskSecret } from '@/lib/crypto.ts'
import { diffOf, record } from '@/lib/audit.ts'
import { providerCatalogue, isKnownProviderType, knownProviderTypes } from '@/modules/email/providers/registry.ts'
import { testProvider } from '@/modules/email/outbound/service.ts'

export const settingsRoutes = new Hono<AppEnv>()
settingsRoutes.use('*', requireAuth)

/**
 * Email providers.
 *
 * The repository exposes two reads and this route only ever uses the masked
 * one. A credential cannot reach a response by accident — it would take
 * deliberately calling the decrypt path, which lives in the send service.
 */
settingsRoutes.get('/email-providers', requirePermission('settings.email_providers.manage'), async (c) => {
  const [providers, mappings] = await Promise.all([
    db()
      .selectFrom('sp_email_providers')
      .select([
        'id', 'type', 'name', 'is_enabled', 'is_global_default', 'source',
        'sender_name', 'sender_email', 'last_tested_at', 'last_test_ok',
        'last_test_detail', 'credentials_encrypted',
      ])
      .orderBy('is_global_default', 'desc')
      .orderBy('name')
      .execute(),
    db().selectFrom('sp_product_email_providers').select(['product_id', 'provider_id']).execute(),
  ])

  const config = c.get('config')

  const rows = await Promise.all(
    providers.map(async (p) => {
      // Decrypt only to mask. The plaintext never leaves this function.
      let masked: Record<string, string> = {}
      if (p.credentials_encrypted && config.credentialsMasterKey) {
        try {
          const parsed = JSON.parse(await decryptSecret(p.credentials_encrypted, config.credentialsMasterKey))
          masked = Object.fromEntries(
            Object.entries(parsed as Record<string, string>).map(([k, v]) => [k, maskSecret(String(v))]),
          )
        } catch {
          masked = { error: 'Stored credential could not be read with the current key' }
        }
      }
      return {
        id: p.id,
        type: p.type,
        name: p.name,
        isEnabled: !!p.is_enabled,
        isGlobalDefault: !!p.is_global_default,
        source: p.source,
        senderName: p.sender_name,
        senderEmail: p.sender_email,
        lastTestedAt: p.last_tested_at,
        lastTestOk: p.last_test_ok == null ? null : !!p.last_test_ok,
        lastTestDetail: p.last_test_detail,
        maskedCredentials: masked,
        productIds: mappings.filter((m) => m.provider_id === p.id).map((m) => m.product_id),
      }
    }),
  )

  return ok(c, rows)
})

/**
 * The provider catalogue.
 *
 * The admin credential form is RENDERED FROM THIS, which is what makes a new
 * vendor a backend-only change: register a definition and its fields appear.
 */
settingsRoutes.get('/email-provider-types', requirePermission('settings.email_providers.view'), (c) =>
  ok(c, providerCatalogue()),
)

settingsRoutes.post(
  '/email-providers/:id{[0-9]+}/test',
  requirePermission('settings.email_providers.manage'),
  async (c) => {
    const id = Number(c.req.param('id'))
    const provider = await db()
      .selectFrom('sp_email_providers')
      .select(['id', 'name', 'type', 'is_enabled'])
      .where('id', '=', id)
      .executeTakeFirst()

    if (!provider) throw new NotFound('That provider does not exist')

    // A real round trip to the vendor through the registry, not a check that
    // the form was filled in — "test connection" that cannot fail is worthless.
    const result = await testProvider(id, c.get('config').credentialsMasterKey)
    const okResult = result.ok
    const detail = result.detail

    await db()
      .updateTable('sp_email_providers')
      .set({
        last_tested_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        last_test_ok: okResult ? 1 : 0,
        last_test_detail: detail,
      })
      .where('id', '=', id)
      .execute()

    return ok(c, { ok: okResult, detail })
  },
)

// ═══════════════════════════════════════════════════════════════════════════
// Provider writes
//
// Credentials are encrypted on the way in and never come back out. The create
// and update paths are the only code that ever sees plaintext.
// ═══════════════════════════════════════════════════════════════════════════

const providerBody = z.object({
  // Validated against the registry rather than a hardcoded list, so a newly
  // registered provider is accepted without editing this file.
  type: z.string().refine(isKnownProviderType, {
    message: `Unknown provider type. Registered types: ${knownProviderTypes().join(', ')}`,
  }),
  name: z.string().trim().min(2, 'Give the provider a name'),
  senderName: z.string().trim().max(120).optional(),
  senderEmail: z.string().trim().email('Enter a valid sender address').optional(),
  /** Vendor-shaped: { apiKey } or { accessKeyId, secretAccessKey, region }. */
  credentials: z.record(z.string()).optional(),
  isEnabled: z.boolean().optional(),
  productIds: z.array(z.number().int().positive()).optional(),
})

async function sealCredentials(c: Ctx, credentials: Record<string, string> | undefined) {
  if (!credentials || !Object.keys(credentials).length) return undefined
  const key = c.get('config').credentialsMasterKey
  if (!key) {
    throw new BadRequest(
      'CREDENTIALS_MASTER_KEY is not set, so provider credentials cannot be stored safely. Generate one with: openssl rand -base64 32',
    )
  }
  return encryptSecret(JSON.stringify(credentials), key)
}

/** Replaces the product→provider mapping for this provider. */
async function mapProducts(providerId: number, productIds: number[] | undefined) {
  if (!productIds) return
  await db().deleteFrom('sp_product_email_providers').where('provider_id', '=', providerId).execute()
  for (const product_id of productIds) {
    // product_id is the primary key: a product routes through exactly one
    // provider, so assigning it here moves it off whatever had it before.
    await db()
      .insertInto('sp_product_email_providers')
      .values({ product_id, provider_id: providerId, is_active: 1 })
      .onConflict((oc) => oc.column('product_id').doUpdateSet({ provider_id: providerId, is_active: 1 }))
      .execute()
  }
}

settingsRoutes.post(
  '/email-providers',
  requirePermission('settings.email_providers.manage'),
  zValidator('json', providerBody, envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const body = c.req.valid('json')
    const sealed = await sealCredentials(c, body.credentials)

    const res = await db()
      .insertInto('sp_email_providers')
      .values({
        type: body.type,
        name: body.name,
        credentials_encrypted: sealed ?? null,
        sender_name: body.senderName ?? null,
        sender_email: body.senderEmail ?? null,
        is_enabled: body.isEnabled === false ? 0 : 1,
        source: 'admin',
      })
      .executeTakeFirstOrThrow()

    const id = Number(res.insertId)
    await mapProducts(id, body.productIds)

    // The first provider has to be the default, or nothing can send at all.
    const count = await db()
      .selectFrom('sp_email_providers')
      .select(({ fn }) => fn.countAll<number>().as('n'))
      .executeTakeFirst()
    if (Number(count?.n ?? 0) === 1) {
      await db().updateTable('sp_email_providers').set({ is_global_default: 1 }).where('id', '=', id).execute()
    }

    // The diff deliberately records THAT credentials were set, never what they are.
    await record(actor, 'email_provider.created', 'email_provider', id, {
      type: body.type, name: body.name, credentialsSet: !!sealed,
    })
    return created(c, { id })
  },
)

settingsRoutes.patch(
  '/email-providers/:id{[0-9]+}',
  requirePermission('settings.email_providers.manage'),
  zValidator('json', providerBody.partial(), envelopeValidation),
  async (c) => {
    const actor = actorOf(c)
    const id = Number(c.req.param('id'))
    const body = c.req.valid('json')

    const before = await db().selectFrom('sp_email_providers').selectAll().where('id', '=', id).executeTakeFirst()
    if (!before) throw new NotFound('That provider does not exist')

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.senderName !== undefined) patch.sender_name = body.senderName || null
    if (body.senderEmail !== undefined) patch.sender_email = body.senderEmail || null
    if (body.isEnabled !== undefined) patch.is_enabled = body.isEnabled ? 1 : 0

    // Credentials are only touched when new ones are supplied: an admin editing
    // the sender name must not have to re-enter the API key.
    const sealed = await sealCredentials(c, body.credentials)
    if (sealed) patch.credentials_encrypted = sealed

    // Disabling the global default would leave nothing able to send.
    if (body.isEnabled === false && before.is_global_default) {
      throw new BadRequest('This is the global default. Make another provider the default before disabling it.')
    }

    if (Object.keys(patch).length) {
      await db().updateTable('sp_email_providers').set(patch).where('id', '=', id).execute()
    }
    await mapProducts(id, body.productIds)

    await record(actor, 'email_provider.updated', 'email_provider', id, {
      ...diffOf(before as never, patch as never),
      credentialsChanged: !!sealed,
    })
    return ok(c, { id })
  },
)

settingsRoutes.post(
  '/email-providers/:id{[0-9]+}/default',
  requirePermission('settings.email_providers.manage'),
  async (c) => {
    const actor = actorOf(c)
    const id = Number(c.req.param('id'))

    const provider = await db()
      .selectFrom('sp_email_providers')
      .select(['id', 'name', 'is_enabled'])
      .where('id', '=', id)
      .executeTakeFirst()
    if (!provider) throw new NotFound('That provider does not exist')
    if (!provider.is_enabled) throw new BadRequest('Enable the provider before making it the default')

    await db().transaction().execute(async (trx) => {
      await trx.updateTable('sp_email_providers').set({ is_global_default: 0 }).execute()
      await trx.updateTable('sp_email_providers').set({ is_global_default: 1 }).where('id', '=', id).execute()
    })

    await record(actor, 'email_provider.default_changed', 'email_provider', id, { name: provider.name })
    return ok(c, { id, isGlobalDefault: true })
  },
)
