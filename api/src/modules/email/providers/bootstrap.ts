import { db } from '@/db/index.ts'
import { encryptSecret } from '@/lib/crypto.ts'
import { isKnownProviderType } from './registry.ts'

/**
 * First-boot email provider.
 *
 * Reads the DEFAULT_EMAIL_PROVIDER_* settings and inserts one provider row with
 * `source = 'bootstrap'`, so a fresh checkout can send mail without anyone
 * opening the admin UI.
 *
 * The guard is a `settings` flag, NOT the presence of a provider row. That
 * distinction matters: an administrator who deliberately deletes the bootstrap
 * provider must not have it resurrected by the next deploy.
 */

const FLAG = 'email_bootstrap_completed'

export interface BootstrapConfig {
  type: string
  name: string
  senderEmail: string
  senderName: string
  /** Vendor-shaped, e.g. { baseUrl } for Mailpit or { apiKey } for SendGrid. */
  credentials: Record<string, string>
}

export interface BootstrapResult {
  created: boolean
  reason: string
}

async function flagIsSet(): Promise<boolean> {
  const row = await db()
    .selectFrom('sp_settings')
    .select(['setting_key'])
    .where('setting_key', '=', FLAG)
    .executeTakeFirst()
  return !!row
}

async function setFlag(detail: Record<string, unknown>): Promise<void> {
  await db()
    .insertInto('sp_settings')
    .values({ setting_key: FLAG, value_json: JSON.stringify({ at: new Date().toISOString(), ...detail }) })
    .onConflict((oc) => oc.column('setting_key').doUpdateSet({ value_json: JSON.stringify({ at: new Date().toISOString(), ...detail }) }))
    .execute()
}

export async function bootstrapEmailProvider(
  cfg: BootstrapConfig | null,
  masterKey: string,
): Promise<BootstrapResult> {
  if (!cfg) {
    return { created: false, reason: 'DEFAULT_EMAIL_PROVIDER_TYPE is not set, so no provider was bootstrapped.' }
  }
  if (!isKnownProviderType(cfg.type)) {
    return { created: false, reason: `"${cfg.type}" is not a registered provider type; nothing was bootstrapped.` }
  }
  if (await flagIsSet()) {
    return { created: false, reason: 'Email bootstrap already ran — administrator configuration left untouched.' }
  }

  const sealed =
    Object.keys(cfg.credentials).length && masterKey
      ? await encryptSecret(JSON.stringify(cfg.credentials), masterKey)
      : null

  const res = await db()
    .insertInto('sp_email_providers')
    .values({
      type: cfg.type,
      name: cfg.name,
      credentials_encrypted: sealed,
      config_json: null,
      is_enabled: 1,
      // Bootstrapped only when nothing else is the default, so re-running this
      // on a configured system can never steal the default away.
      is_global_default: 0,
      source: 'bootstrap',
      sender_name: cfg.senderName || null,
      sender_email: cfg.senderEmail || null,
    })
    .executeTakeFirstOrThrow()

  const id = Number(res.insertId)

  const existingDefault = await db()
    .selectFrom('sp_email_providers')
    .select(['id'])
    .where('is_global_default', '=', 1)
    .executeTakeFirst()

  if (!existingDefault) {
    await db().updateTable('sp_email_providers').set({ is_global_default: 1 }).where('id', '=', id).execute()
  }

  await setFlag({ providerId: id, type: cfg.type })

  return {
    created: true,
    reason: `Bootstrapped "${cfg.name}" (${cfg.type})${existingDefault ? '' : ' as the global default'}, sending as ${
      cfg.senderEmail || '(no sender set)'
    }.`,
  }
}
