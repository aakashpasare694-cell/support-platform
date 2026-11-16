/**
 * Configuration.
 *
 * RULE: nothing is read at import time. `buildConfig(env)` runs per request on
 * Workers and once at boot on Node, so the app never depends on `process.env`
 * having been populated before modules load — and secrets are never captured
 * into module scope.
 */

export interface Env {
  NODE_ENV?: string
  APP_ENV?: string
  PORT?: string
  CORS_ORIGINS?: string

  /** Path to the SQLite file, relative to the project root. */
  DB_FILE?: string

  JWT_SECRET?: string
  ACCESS_TOKEN_TTL?: string
  REFRESH_TOKEN_TTL?: string
  CREDENTIALS_MASTER_KEY?: string
  INBOUND_WEBHOOK_SECRET?: string
  INGEST_DOMAIN?: string

  /** First-boot email provider. Mailpit locally; a real vendor in production. */
  DEFAULT_EMAIL_PROVIDER_TYPE?: string
  DEFAULT_EMAIL_PROVIDER_NAME?: string
  DEFAULT_EMAIL_PROVIDER_SENDER_EMAIL?: string
  DEFAULT_EMAIL_PROVIDER_SENDER_NAME?: string
  /** Mailpit's web UI address — the HTTP API lives there, not on the SMTP port. */
  MAILPIT_BASE_URL?: string
  MAILPIT_USERNAME?: string
  MAILPIT_PASSWORD?: string
  /** Used by sendgrid/resend/ses once those adapters are registered. */
  DEFAULT_EMAIL_PROVIDER_API_KEY?: string

  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  CACHE_PREFIX?: string

  /** Cloudflare D1 binding, present only on Workers. D1 is SQLite too, so the
   *  SQL is identical — only the driver differs. */
  DB?: unknown
}

export interface Config {
  isProduction: boolean
  appEnv: string
  corsOrigins: string[]
  db: {
    file: string
  }
  auth: {
    jwtSecret: string
    accessTtl: number
    refreshTtl: number
  }
  credentialsMasterKey: string
  /** Shared secret the mail source must present. */
  inboundSecret: string
  /** Domain our outgoing Message-IDs are stamped with. */
  ingestDomain: string
  cache: {
    url?: string
    token?: string
    prefix: string
  }
  /** Null when no bootstrap provider is configured. */
  defaultEmailProvider: {
    type: string
    name: string
    senderEmail: string
    senderName: string
    credentials: Record<string, string>
  } | null
}

/**
 * Builds the bootstrap provider description from env.
 *
 * Credentials are shaped per vendor, which is why this is a switch rather than
 * one generic blob: Mailpit needs a URL, the API vendors need a key.
 */
function buildDefaultEmailProvider(env: Env): Config['defaultEmailProvider'] {
  const type = env.DEFAULT_EMAIL_PROVIDER_TYPE?.trim()
  if (!type) return null

  const credentials: Record<string, string> =
    type === 'mailpit'
      ? {
          baseUrl: env.MAILPIT_BASE_URL?.trim() || 'http://127.0.0.1:8025',
          ...(env.MAILPIT_USERNAME ? { username: env.MAILPIT_USERNAME } : {}),
          ...(env.MAILPIT_PASSWORD ? { password: env.MAILPIT_PASSWORD } : {}),
        }
      : env.DEFAULT_EMAIL_PROVIDER_API_KEY
        ? { apiKey: env.DEFAULT_EMAIL_PROVIDER_API_KEY }
        : {}

  return {
    type,
    name: env.DEFAULT_EMAIL_PROVIDER_NAME?.trim() || (type === 'mailpit' ? 'Mailpit (local)' : type),
    senderEmail: env.DEFAULT_EMAIL_PROVIDER_SENDER_EMAIL?.trim() || '',
    senderName: env.DEFAULT_EMAIL_PROVIDER_SENDER_NAME?.trim() || '',
    credentials,
  }
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function buildConfig(env: Env): Config {
  return {
    isProduction: env.NODE_ENV === 'production',
    appEnv: env.APP_ENV ?? 'local',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3040')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    db: {
      file: env.DB_FILE ?? './data/support-platform.db',
    },
    auth: {
      jwtSecret: env.JWT_SECRET ?? '',
      accessTtl: num(env.ACCESS_TOKEN_TTL, 900),
      refreshTtl: num(env.REFRESH_TOKEN_TTL, 2_592_000),
    },
    credentialsMasterKey: env.CREDENTIALS_MASTER_KEY ?? '',
    inboundSecret: env.INBOUND_WEBHOOK_SECRET ?? '',
    ingestDomain: env.INGEST_DOMAIN ?? 'incomingmail.charityerp.com',
    cache: {
      url: env.UPSTASH_REDIS_REST_URL || undefined,
      token: env.UPSTASH_REDIS_REST_TOKEN || undefined,
      prefix: env.CACHE_PREFIX ?? 'sp',
    },
    defaultEmailProvider: buildDefaultEmailProvider(env),
  }
}

/** Fail fast on boot rather than on the first request that needs a secret. */
export function assertUsableConfig(c: Config): void {
  const problems: string[] = []
  if (c.auth.jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters')
  if (c.isProduction && !c.credentialsMasterKey) problems.push('CREDENTIALS_MASTER_KEY is required in production')
  if (problems.length) {
    throw new Error(`Configuration is not usable:\n  - ${problems.join('\n  - ')}`)
  }
}
