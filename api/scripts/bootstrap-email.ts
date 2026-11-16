import 'dotenv/config'
import { buildConfig } from '../src/config/index.ts'
import { createNodeDb, closeDb } from '../src/db/sqlite.ts'
import { db, setDefaultDb } from '../src/db/index.ts'
import { bootstrapEmailProvider } from '../src/modules/email/providers/bootstrap.ts'
import { knownProviderTypes } from '../src/modules/email/providers/registry.ts'
import { testProvider } from '../src/modules/email/outbound/service.ts'

/**
 * Installs the DEFAULT_EMAIL_PROVIDER_* provider, then tests it.
 *
 * Separate from `npm run seed` so it can be re-run on an existing database
 * without touching users or vocabulary.
 *
 *   --make-default   promote it to the global default even if another provider
 *                    already holds that slot
 *   --force          clear the `email_bootstrap_completed` flag first, so the
 *                    provider is created again after a deliberate deletion
 */

const args = new Set(process.argv.slice(2))
const makeDefault = args.has('--make-default')
const force = args.has('--force')

async function main() {
  const config = buildConfig(process.env as Record<string, string | undefined>)
  setDefaultDb(createNodeDb(config))

  console.log(`Registered provider types: ${knownProviderTypes().join(', ')}`)

  if (force) {
    await db().deleteFrom('sp_settings').where('setting_key', '=', 'email_bootstrap_completed').execute()
    console.log('Cleared the bootstrap guard (--force).')
  }

  const result = await bootstrapEmailProvider(config.defaultEmailProvider, config.credentialsMasterKey)
  console.log(result.created ? `Created: ${result.reason}` : `Skipped: ${result.reason}`)

  const type = config.defaultEmailProvider?.type
  const provider = type
    ? await db()
        .selectFrom('sp_email_providers')
        .select(['id', 'name', 'type', 'is_global_default'])
        .where('type', '=', type)
        .orderBy('id', 'desc')
        .executeTakeFirst()
    : undefined

  if (!provider) {
    console.log('No provider of the configured type is present; nothing to test.')
    await closeDb()
    return
  }

  if (makeDefault && !provider.is_global_default) {
    // Exactly one row may be the default, so the old one is cleared first.
    await db().updateTable('sp_email_providers').set({ is_global_default: 0 }).execute()
    await db().updateTable('sp_email_providers').set({ is_global_default: 1 }).where('id', '=', provider.id).execute()
    console.log(`Promoted "${provider.name}" to the global default.`)
  }

  const test = await testProvider(provider.id, config.credentialsMasterKey)
  console.log(`\nTest connection: ${test.ok ? 'OK' : 'FAILED'}\n  ${test.detail}`)

  const defaults = await db()
    .selectFrom('sp_email_providers')
    .select(['id', 'name', 'type', 'is_enabled', 'is_global_default'])
    .execute()
  console.log('\nProviders now configured:')
  for (const p of defaults) {
    const flags = [p.is_global_default ? 'DEFAULT' : null, p.is_enabled ? 'enabled' : 'disabled']
      .filter(Boolean)
      .join(', ')
    const registered = knownProviderTypes().includes(p.type) ? '' : '  <-- no adapter registered: cannot send'
    console.log(`  [${p.id}] ${p.name} (${p.type}) — ${flags}${registered}`)
  }

  await closeDb()
}

main().catch(async (err) => {
  console.error(err)
  await closeDb().catch(() => {})
  process.exit(1)
})
