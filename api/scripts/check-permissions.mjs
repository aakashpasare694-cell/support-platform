#!/usr/bin/env node
/**
 * Every permission string used in a route must exist in the seed catalogue.
 *
 * A renamed permission that a route still asks for is invisible until someone
 * hits that endpoint and gets a 403 for a permission nobody can grant — which
 * is exactly how `ticket.view` survived a rename.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const seed = await readFile('scripts/seed.ts', 'utf8')

// Scan ONLY the PERMISSIONS array. Matching the whole file also picked up the
// ROLES entries, which have the same ['code', 'Name', 'Description', …] shape —
// so a route asking for requirePermission('admin') would have passed this
// check purely because 'admin' happens to be a role code.
const block = seed.slice(seed.indexOf('const PERMISSIONS'))
const permissionsArray = block.slice(0, block.indexOf('\n]\n'))
const catalogue = new Set(
  [...permissionsArray.matchAll(/\['([a-z][a-z0-9_.]*)',\s*'[^']+',\s*'/g)].map((m) => m[1]),
)

async function walk(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else if (e.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const problems = []
for (const file of await walk('src')) {
  const text = await readFile(file, 'utf8')
  for (const m of text.matchAll(/(?:requirePermission|can)\(\s*(?:actor,\s*)?'([a-z][a-z0-9_.]*)'/g)) {
    if (!catalogue.has(m[1])) problems.push(`  ${file}: "${m[1]}" is not in the seed catalogue`)
  }
}

if (problems.length) {
  console.error('Permission check FAILED:\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`Permission check passed (${catalogue.size} codes in the catalogue).`)
