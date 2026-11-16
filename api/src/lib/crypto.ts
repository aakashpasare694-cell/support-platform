/**
 * Crypto. WebCrypto only — it is the one implementation available in both
 * runtimes, and it avoids the native modules Workers cannot load.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// ─── password hashing ───────────────────────────────────────────────────────
// PBKDF2-SHA256 via WebCrypto. bcrypt and argon2 are native modules and simply
// cannot run on Workers, so this is a hard constraint rather than a preference.

const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const KEY_BITS = 256

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

/** Produces `pbkdf2$<iterations>$<salt_b64>$<hash_b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return ['pbkdf2', PBKDF2_ITERATIONS, toB64(salt), toB64(hash)].join('$')
}

/** Constant time, so a wrong password cannot be guessed byte by byte by timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations < 1) return false
  const salt = fromB64(parts[2] as string)
  const expected = fromB64(parts[3] as string)
  const actual = await pbkdf2(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}

// ─── opaque tokens ──────────────────────────────────────────────────────────

/** Refresh tokens are random and opaque; only their hash is ever stored. */
export function randomToken(bytes = 32): string {
  const raw = toB64(crypto.getRandomValues(new Uint8Array(bytes)))
  return raw.split('+').join('-').split('/').join('_').split('=').join('')
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── provider credential encryption ─────────────────────────────────────────
// AES-256-GCM with a random IV per record, stored as v1:{iv}:{ciphertext}.
// The version prefix is what makes key rotation possible later.

async function masterKey(rawBase64: string): Promise<CryptoKey> {
  const raw = fromB64(rawBase64)
  if (raw.length !== 32) {
    throw new Error('CREDENTIALS_MASTER_KEY must decode to exactly 32 bytes (openssl rand -base64 32)')
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await masterKey(keyB64)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plaintext))
  return ['v1', toB64(iv), toB64(new Uint8Array(ct))].join(':')
}

export async function decryptSecret(payload: string, keyB64: string): Promise<string> {
  const [version, ivB64, ctB64] = payload.split(':')
  if (version !== 'v1' || !ivB64 || !ctB64) throw new Error('Unrecognised credential format')
  const key = await masterKey(keyB64)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) as BufferSource },
    key,
    fromB64(ctB64) as BufferSource,
  )
  return dec.decode(pt)
}

/** `SG.p7Kd••••••••••3f2a` — what the API returns in place of a credential. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••'
  return secret.slice(0, 7) + '•'.repeat(10) + secret.slice(-4)
}
