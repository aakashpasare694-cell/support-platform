import { SignJWT, jwtVerify } from 'jose'

/**
 * Access tokens: short-lived, stateless, HS256 via `jose` (WebCrypto under the
 * hood, so it works unchanged in both runtimes).
 *
 * Revocation lives with the refresh token, which IS stored (hashed) and can be
 * revoked per device. An access token is deliberately short so that a revoked
 * session dies within its TTL without a lookup on every request.
 */

export interface AccessClaims {
  sub: string
  email: string
  name: string
  jti: string
}

const ISSUER = 'support-platform'
const AUDIENCE = 'support-platform-api'

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signAccessToken(
  claims: Omit<AccessClaims, 'jti'> & { jti?: string },
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const jti = claims.jti ?? crypto.randomUUID()
  return new SignJWT({ email: claims.email, name: claims.name, jti })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key(secret))
}

/** Throws if the signature, issuer, audience or expiry does not check out. */
export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  })
  return {
    sub: String(payload.sub),
    email: String(payload.email ?? ''),
    name: String(payload.name ?? ''),
    jti: String(payload.jti ?? ''),
  }
}
