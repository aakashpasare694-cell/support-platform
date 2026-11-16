/**
 * HTTP client.
 *
 * One place that knows about the API envelope, the access token and the
 * refresh dance. Everything else calls `get` / `post` / `patch` and receives
 * the unwrapped `data`.
 */

export interface ApiMeta {
  page?: number
  perPage?: number
  total?: number
  pages?: number
  [key: string]: unknown
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, string>,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * The access token lives in memory only.
 *
 * On reload it is gone and the httpOnly refresh cookie mints a new one, so a
 * stolen localStorage entry is not a usable session. The cost is one extra
 * request on boot, which is worth it.
 */
let accessToken: string | null = null
let onUnauthenticated: (() => void) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export function setUnauthenticatedHandler(fn: (() => void) | null) {
  onUnauthenticated = fn
}

/** Relative base: Vite proxies it in dev, same origin in production. */
const BASE = '/api/v1'

async function parse(res: Response) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError('BAD_RESPONSE', `The server returned something unreadable (${res.status})`, res.status)
  }
}

/**
 * Refresh is SINGLE-FLIGHT.
 *
 * Refresh tokens rotate, so two concurrent calls send the same cookie and the
 * second looks like a replayed token. Sharing one in-flight promise means
 * concurrent callers — two requests both hitting 401, or an effect that runs
 * twice — wait on the same request instead of racing each other.
 */
let inFlightRefresh: Promise<boolean> | null = null

function refreshAccessToken(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh

  inFlightRefresh = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!res.ok) return false
      const body = await parse(res)
      const token = body?.data?.accessToken
      if (!token) return false
      accessToken = token
      return true
    } catch {
      return false
    } finally {
      inFlightRefresh = null
    }
  })()

  return inFlightRefresh
}

/** Used by the auth provider on boot, so it shares the same single flight. */
export function refreshSession(): Promise<boolean> {
  return refreshAccessToken()
}

interface RequestOptions {
  method?: string
  body?: unknown
  /** Set false on the auth calls, so a failed refresh cannot recurse. */
  retryOnUnauthorized?: boolean
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; meta?: ApiMeta }> {
  const { method = 'GET', body, retryOnUnauthorized = true, signal } = opts

  const send = async (): Promise<Response> =>
    fetch(`${BASE}${path}`, {
      method,
      signal,
      // The refresh token is an httpOnly cookie, so the browser must send it.
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

  let res: Response
  try {
    res = await send()
  } catch {
    throw new ApiError('NETWORK', 'Could not reach the API. Is it running on port 8900?', 0)
  }

  // One retry after a refresh — an expired access token should be invisible.
  if (res.status === 401 && retryOnUnauthorized) {
    if (await refreshAccessToken()) {
      res = await send()
    } else {
      accessToken = null
      onUnauthenticated?.()
    }
  }

  const payload = await parse(res)

  if (!res.ok || payload?.success === false) {
    const err = payload?.error ?? {}
    throw new ApiError(
      err.code ?? 'ERROR',
      err.message ?? `Request failed (${res.status})`,
      res.status,
      err.details,
      payload?.requestId,
    )
  }

  return { data: payload?.data as T, meta: payload?.meta as ApiMeta | undefined }
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await request<T>(path, { signal })).data
}

export async function getWithMeta<T>(path: string, signal?: AbortSignal) {
  return request<T>(path, { signal })
}

export async function post<T>(path: string, body?: unknown, retryOnUnauthorized = true): Promise<T> {
  return (await request<T>(path, { method: 'POST', body, retryOnUnauthorized })).data
}

export async function patch<T>(path: string, body: unknown): Promise<T> {
  return (await request<T>(path, { method: 'PATCH', body })).data
}

export async function del<T>(path: string): Promise<T> {
  return (await request<T>(path, { method: 'DELETE' })).data
}

/** Builds a query string, dropping empties and expanding arrays. */
export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) value.forEach((v) => sp.append(key, String(v)))
    else sp.set(key, String(value))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
