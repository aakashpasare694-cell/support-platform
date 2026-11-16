/**
 * Typed errors. Services throw these; one `onError` handler turns them into
 * responses. No module builds an error response by hand, which is what keeps
 * the envelope consistent.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class BadRequest extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super('BAD_REQUEST', message, 400, details)
  }
}

export class Unauthorized extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401)
  }
}

export class Forbidden extends AppError {
  constructor(message = 'You do not have permission to do that') {
    super('FORBIDDEN', message, 403)
  }
}

/**
 * Used for records outside the caller's product scope as well as records that
 * genuinely do not exist. Returning 403 for the former would confirm the id
 * exists and let someone enumerate another product's tickets.
 */
export class NotFound extends AppError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', message, 404)
  }
}

export class Conflict extends AppError {
  constructor(message = 'That conflicts with something that already exists', details?: unknown) {
    super('CONFLICT', message, 409, details)
  }
}

export class ValidationFailed extends AppError {
  constructor(details: unknown, message = 'Some fields need attention') {
    super('VALIDATION_FAILED', message, 422, details)
  }
}

export class TooManyRequests extends AppError {
  readonly retryAfter: number
  constructor(message = 'Too many requests. Try again shortly.', retryAfter = 60) {
    super('TOO_MANY_REQUESTS', message, 429)
    this.retryAfter = retryAfter
  }
}
