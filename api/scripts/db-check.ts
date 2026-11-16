import 'dotenv/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { buildConfig } from '../src/config/index.ts'

/** Connection sanity check — run this before blaming the app. */
const config = buildConfig(process.env as Record<string, string | undefined>)
const file = resolve(config.db.file)

if (!existsSync(file)) {
  console.error(`No database at ${file}`)
  console.error('Run: npm run migrate && npm run seed')
  process.exit(1)
}

try {
  const db = new Database(file, { readonly: true })
  const { version } = db.prepare('SELECT sqlite_version() AS version').get() as { version: string }
  const tables = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'sp_%'")
    .get() as { n: number }
  const users = db.prepare('SELECT COUNT(*) AS n FROM sp_users').get() as { n: number }
  console.log(`SQLite ${version} — ${file}`)
  console.log(`  ${tables.n} tables, ${users.n} user(s)`)
  db.close()
} catch (err) {
  console.error(`Could not read ${file}`)
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
