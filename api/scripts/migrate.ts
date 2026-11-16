import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { buildConfig } from '../src/config/index.ts'

/**
 * Migration runner.
 *
 * Numbered SQL files, applied in order, recorded in `schema_migrations`.
 * Each file runs inside a transaction, so a failure half-way leaves the
 * database exactly as it was rather than partly migrated.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const config = buildConfig(process.env as Record<string, string | undefined>)
const file = resolve(config.db.file)
mkdirSync(dirname(file), { recursive: true })

const db = new Database(file)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT NOT NULL PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

const applied = new Set(
  db.prepare('SELECT filename FROM schema_migrations').all().map((r) => (r as { filename: string }).filename),
)

const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()

if (process.argv.includes('--status')) {
  console.log('\n  migration                          status')
  console.log('  ---------------------------------- --------')
  for (const f of files) console.log(`  ${f.padEnd(34)} ${applied.has(f) ? 'applied' : 'PENDING'}`)
  console.log(`\n  database: ${file}\n`)
  db.close()
  process.exit(0)
}

const pending = files.filter((f) => !applied.has(f))
if (!pending.length) {
  console.log(`Nothing to apply — ${file} is up to date.`)
  db.close()
  process.exit(0)
}

const record = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)')

for (const name of pending) {
  const sql = await readFile(join(DIR, name), 'utf8')
  process.stdout.write(`Applying ${name}… `)
  try {
    // better-sqlite3 runs a whole script with exec(); wrapping it in a
    // transaction makes the file atomic.
    db.transaction(() => {
      db.exec(sql)
      record.run(name)
    })()
    console.log('ok')
  } catch (err) {
    console.log('FAILED')
    console.error(err instanceof Error ? err.message : err)
    db.close()
    process.exit(1)
  }
}

db.close()
console.log(`\nApplied ${pending.length} migration(s) to ${file}.`)
