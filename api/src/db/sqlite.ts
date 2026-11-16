import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import type { Config } from '@/config/index.ts'
import type { DB } from './schema.ts'

/**
 * SQLite connection.
 *
 * One file, no server. The same engine Cloudflare D1 runs, so production on
 * Workers is the same SQL through a different binding rather than a second
 * dialect to keep in sync.
 */
let handle: Database.Database | null = null
let instance: Kysely<DB> | null = null

function openFile(path: string): Database.Database {
  const full = resolve(path)
  mkdirSync(dirname(full), { recursive: true })
  const db = new Database(full)

  // WAL lets reads continue during a write, which matters as soon as two
  // requests overlap. NORMAL is the usual durability trade alongside it.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  // SQLite ignores FOREIGN KEY clauses unless this is on, per connection.
  db.pragma('foreign_keys = ON')
  // Wait rather than fail instantly when another writer holds the lock.
  db.pragma('busy_timeout = 5000')
  return db
}

export function getSqlite(config: Config): Database.Database {
  if (!handle) handle = openFile(config.db.file)
  return handle
}

export function createNodeDb(config: Config): Kysely<DB> {
  if (!instance) {
    instance = new Kysely<DB>({ dialect: new SqliteDialect({ database: getSqlite(config) }) })
  }
  return instance
}

export async function closeDb(): Promise<void> {
  await instance?.destroy()
  instance = null
  handle = null
}
