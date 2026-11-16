import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { assertUsableConfig, buildConfig } from './config/index.ts'
import { createNodeDb, closeDb } from './db/sqlite.ts'
import { setDefaultDb } from './db/index.ts'

/**
 * Node entry.
 *
 * `process.env` is handed to the app as the Env object, so configuration is
 * read exactly the same way it is on Workers.
 */
const env = process.env as Record<string, string | undefined>
const config = buildConfig(env)
assertUsableConfig(config)

// One long-lived Kysely instance over the SQLite file, installed as the
// fallback used whenever there is no per-request scope.
setDefaultDb(createNodeDb(config))

const app = createApp(env)
const port = Number(env.PORT ?? 8900)

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`support-platform-api listening on http://localhost:${info.port} (${config.appEnv})`)
  console.log(`database: ${config.db.file}`)
})

async function shutdown(signal: string) {
  console.log(`\n${signal} received, closing down…`)
  server.close()
  await closeDb()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
