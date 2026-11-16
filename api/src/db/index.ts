import { AsyncLocalStorage } from 'node:async_hooks'
import type { Kysely, Transaction } from 'kysely'
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

/**
 * Whether the current database can run an interactive transaction.
 *
 * Cloudflare D1 cannot: the driver answers "Transactions are not supported
 * yet." D1 offers `batch()` for atomicity, but a batch cannot read between
 * statements, and these write paths all do — insert a ticket, read its id,
 * insert the first message against it.
 */
const transactional = new AsyncLocalStorage<boolean>()
let fallbackTransactional = true

export function runWithDb<T>(scoped: Kysely<DB>, fn: () => T, supportsTransactions = true): T {
  return store.run(scoped, () => transactional.run(supportsTransactions, fn))
}

export function setTransactionSupport(supported: boolean): void {
  fallbackTransactional = supported
}

export function supportsTransactions(): boolean {
  return transactional.getStore() ?? fallbackTransactional
}

/**
 * Runs `fn` in a transaction where the runtime has them, and sequentially
 * where it does not.
 *
 * On Node (better-sqlite3) this is a real transaction and rolls back. On D1 the
 * statements run one after another and a mid-way failure leaves earlier writes
 * in place — the pipeline's idempotency guards and the unique index on
 * ticket_messages.message_id are what keep a retry from duplicating, rather
 * than rollback. Worth knowing before adding a write path that assumes atomicity.
 */
export async function withTransaction<T>(fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  if (supportsTransactions()) {
    return db().transaction().execute((trx) => fn(trx as unknown as Kysely<DB>))
  }
  return fn(db())
}

export type { DB } from './schema.ts'
export type { Transaction }
