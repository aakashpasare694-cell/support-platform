import { AsyncLocalStorage } from 'node:async_hooks'
import type { Kysely } from 'kysely'
import type { DB } from './schema.ts'

/**
 * One accessor for the database, resolved through AsyncLocalStorage.
 *
 * This is why no module below the entry points ever imports a connection: the
 * Kysely instance is ambient. On Workers each request runs inside
 * `runWithDb(...)` with its own Hyperdrive-backed instance; on Node the scope is
 * absent and the lazily-created singleton over the bounded pool is used.
 */
const store = new AsyncLocalStorage<Kysely<DB>>()

let fallback: Kysely<DB> | null = null

export function runWithDb<T>(scoped: Kysely<DB>, fn: () => T): T {
  return store.run(scoped, fn)
}

/** Node only: install the long-lived instance used outside a request scope. */
export function setDefaultDb(instance: Kysely<DB>): void {
  fallback = instance
}

export function db(): Kysely<DB> {
  const scoped = store.getStore()
  if (scoped) return scoped
  if (!fallback) {
    throw new Error(
      'No database available. On Workers every request must run inside runWithDb(); on Node call setDefaultDb() at boot.',
    )
  }
  return fallback
}

export type { DB } from './schema.ts'
