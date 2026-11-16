import type { ZodError } from 'zod'
import { ValidationFailed } from './errors.ts'

/**
 * Validation failures go through OUR envelope.
 *
 * @hono/zod-validator answers with its own raw ZodError response by default,
 * which bypasses the error handler and leaks zod's internal shape to the
 * client. Passing this hook makes it throw instead, so a 422 comes back in the
 * same `{ success, error, requestId }` envelope as everything else.
 *
 * Every route passes this as the third argument to zValidator.
 */
export function fieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export function envelopeValidation(
  result: { success: true } | { success: false; error: ZodError },
): void {
  if (!result.success) throw new ValidationFailed(fieldErrors(result.error))
}
