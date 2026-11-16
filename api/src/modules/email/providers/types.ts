/**
 * The email vendor seam.
 *
 * Business logic never names a vendor. It asks the registry for the provider
 * configured against a product, hands it an OutboundMessage, and gets back a
 * provider message id. Adding Mailgun later is one new file plus one
 * `register()` call — and, because the admin form is generated from
 * `credentialFields`, no frontend change at all.
 */

/** Describes one credential input so the admin UI can render its own form. */
export interface CredentialFieldDescriptor {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  required: boolean
  placeholder?: string
  help?: string
}

export interface Addressee {
  name?: string | null
  address: string
}

/**
 * A message ready to leave the building.
 *
 * `messageId`, `inReplyTo` and `references` carry angle brackets exactly as
 * they appear on the wire — a provider that strips them breaks threading, so
 * the shape keeps them explicit rather than letting each adapter guess.
 */
export interface OutboundMessage {
  from: Addressee
  to: Addressee[]
  cc?: Addressee[]
  replyTo?: string | null
  subject: string
  html: string
  text: string
  messageId: string
  inReplyTo?: string | null
  references?: string[]
}

export interface SendResult {
  providerMessageId: string
}

export interface TestResult {
  ok: boolean
  detail: string
}

export interface EmailProvider {
  readonly type: string
  send(msg: OutboundMessage): Promise<SendResult>
  /** A real round trip to the vendor, not a configuration check. */
  testConnection(): Promise<TestResult>
}

/** What the registry hands a factory once the row has been decrypted. */
export interface ProviderContext {
  credentials: Record<string, string>
  config: Record<string, unknown>
}

export interface ProviderDefinition {
  type: string
  label: string
  /** Shown under the type in the admin UI, so the choice explains itself. */
  description: string
  credentialFields: CredentialFieldDescriptor[]
  create: (ctx: ProviderContext) => EmailProvider
}

/** Thrown when sending cannot even be attempted — never swallowed silently. */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(message)
    this.name = 'EmailSendError'
  }
}
