#!/usr/bin/env node
/**
 * Fails the build on an import Workers cannot load.
 *
 * Catching this at commit time is the whole point — discovering that bcrypt
 * cannot run on workerd during a deploy is an expensive way to learn it.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const BANNED = [
  ['bcrypt', 'native module — use PBKDF2 via WebCrypto (src/lib/crypto.ts)'],
  ['argon2', 'native module — use PBKDF2 via WebCrypto (src/lib/crypto.ts)'],
  ['node:fs', 'no filesystem on Workers'],
  ['node:child_process', 'not available on Workers'],
  ['node:worker_threads', 'not available on Workers'],
  ['ioredis', 'TCP Redis client — use @upstash/redis over REST'],
  ['@aws-sdk/', 'too large for a Worker bundle — use aws4fetch'],
  ['nodemailer', 'SMTP over raw TCP — use a provider HTTP API'],
]

// Scripts are Node-only by design and never bundled into the Worker.
const EXEMPT_DIRS = ['scripts']

// Node-only modules that the Worker entry never imports. src/index.worker.ts
// reaches the database through the D1 binding instead, so better-sqlite3 and
// its filesystem access stay out of that bundle. Keep this list short and
// justified — it is the one way to silence the check.
const EXEMPT_FILES = ['src/db/sqlite.ts']

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const files = (await walk('src')).filter(
  (f) => !EXEMPT_DIRS.some((d) => f.startsWith(d + '/')) && !EXEMPT_FILES.includes(f),
)

// An exemption is only safe while the Worker entry really does not pull it in.
const workerEntry = await readFile('src/index.worker.ts', 'utf8')
for (const exempt of EXEMPT_FILES) {
  const spec = exempt.replace('src/', './').replace(/\.ts$/, '')
  if (workerEntry.includes(spec)) {
    console.error(`Workers compatibility check FAILED:\n  src/index.worker.ts imports ${exempt}, which is exempted as Node-only`)
    process.exit(1)
  }
}
const problems = []

for (const file of files) {
  const text = await readFile(file, 'utf8')
  for (const [needle, why] of BANNED) {
    if (text.includes(`'${needle}`) || text.includes(`"${needle}`)) {
      problems.push(`  ${file}: imports ${needle} — ${why}`)
    }
  }
}

if (problems.length) {
  console.error('Workers compatibility check FAILED:\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`Workers compatibility check passed (${files.length} files).`)
