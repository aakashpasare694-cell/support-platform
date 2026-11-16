import { db } from '@/db/index.ts'
import { sha256Hex } from '@/lib/crypto.ts'

/** All SQL for authentication lives here — nothing above this layer writes queries. */

export function findUserByEmail(email: string) {
  return db()
    .selectFrom('sp_users')
    .select(['id', 'email', 'name', 'password_hash', 'is_active', 'avatar_color', 'job_title'])
    .where('email', '=', email.trim().toLowerCase())
    .executeTakeFirst()
}

export function findUserById(id: number) {
  return db()
    .selectFrom('sp_users')
    .select(['id', 'email', 'name', 'is_active', 'avatar_color', 'job_title', 'timezone'])
    .where('id', '=', id)
    .executeTakeFirst()
}

export async function touchLastLogin(id: number) {
  await db()
    .updateTable('sp_users')
    .set({ last_login_at: new Date().toISOString().slice(0, 19).replace('T', ' ') })
    .where('id', '=', id)
    .execute()
}

export async function storeRefreshToken(input: {
  userId: number
  token: string
  expiresAt: Date
  userAgent?: string
  ip?: string
}) {
  await db()
    .insertInto('sp_refresh_tokens')
    .values({
      user_id: input.userId,
      token_hash: await sha256Hex(input.token),
      expires_at: input.expiresAt.toISOString().slice(0, 19).replace('T', ' '),
      user_agent: input.userAgent?.slice(0, 255) ?? null,
      ip: input.ip?.slice(0, 45) ?? null,
    })
    .execute()
}

export async function findRefreshToken(token: string) {
  return db()
    .selectFrom('sp_refresh_tokens')
    .select(['id', 'user_id', 'expires_at', 'revoked_at'])
    .where('token_hash', '=', await sha256Hex(token))
    .executeTakeFirst()
}

export async function revokeRefreshToken(id: number) {
  await db()
    .updateTable('sp_refresh_tokens')
    .set({ revoked_at: new Date().toISOString().slice(0, 19).replace('T', ' ') })
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .execute()
}

/**
 * Revokes every live session for a user. Called when a refresh token is
 * replayed after it was already used, which means the token leaked.
 */
export async function revokeAllForUser(userId: number) {
  await db()
    .updateTable('sp_refresh_tokens')
    .set({ revoked_at: new Date().toISOString().slice(0, 19).replace('T', ' ') })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute()
}
