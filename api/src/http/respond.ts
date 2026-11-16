import type { Context } from 'hono'

/**
 * The one response envelope. Every endpoint returns one of these shapes, and
 * real HTTP status codes are used — a business failure is not a 200.
 *
 *   success: { success: true, data, meta? }
 *   failure: { success: false, error: { code, message, details? }, requestId }
 *
 * Failures are built only by the error handler in `app.ts`, so no module can
 * invent a different shape.
 */
export interface Meta {
  page?: number
  perPage?: number
  total?: number
  [key: string]: unknown
}

export function ok<T>(c: Context, data: T, meta?: Meta) {
  return c.json({ success: true as const, data, ...(meta ? { meta } : {}) }, 200)
}

export function created<T>(c: Context, data: T) {
  return c.json({ success: true as const, data }, 201)
}

export function noContent(c: Context) {
  return c.body(null, 204)
}

export function paginated<T>(
  c: Context,
  rows: T[],
  { page, perPage, total }: { page: number; perPage: number; total: number },
) {
  return c.json({
    success: true as const,
    data: rows,
    meta: { page, perPage, total, pages: Math.max(1, Math.ceil(total / perPage)) },
  })
}
