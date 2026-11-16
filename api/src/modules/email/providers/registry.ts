import { mailpitDefinition } from './mailpit.ts'
import type { EmailProvider, ProviderContext, ProviderDefinition } from './types.ts'
import { EmailSendError } from './types.ts'

/**
 * The provider registry.
 *
 * Vendor names live here and nowhere else. `sp_email_providers.type` is just a
 * string resolved through this map, so a provider is added by registering a
 * definition — not by touching the send path, the admin routes or the UI.
 */

const definitions = new Map<string, ProviderDefinition>()

function register(def: ProviderDefinition): void {
  definitions.set(def.type, def)
}

register(mailpitDefinition)
// SendGrid, Resend and SES register here. Each is one file implementing
// EmailProvider; nothing below this line changes when they arrive.

/** Every registered type — this is what the admin UI builds its form from. */
export function providerCatalogue(): {
  type: string
  label: string
  description: string
  credentialFields: ProviderDefinition['credentialFields']
}[] {
  return [...definitions.values()].map(({ type, label, description, credentialFields }) => ({
    type,
    label,
    description,
    credentialFields,
  }))
}

export function isKnownProviderType(type: string): boolean {
  return definitions.has(type)
}

export function knownProviderTypes(): string[] {
  return [...definitions.keys()]
}

/**
 * Builds a live provider from a stored row's decrypted credentials.
 *
 * Throws rather than returning null: a ticket reply that cannot resolve a
 * provider must fail loudly and be visible on the message, never be dropped
 * on the floor.
 */
export function createProvider(type: string, ctx: ProviderContext): EmailProvider {
  const def = definitions.get(type)
  if (!def) {
    throw new EmailSendError(
      `No provider is registered for type "${type}". Registered types: ${knownProviderTypes().join(', ') || 'none'}.`,
    )
  }
  return def.create(ctx)
}
