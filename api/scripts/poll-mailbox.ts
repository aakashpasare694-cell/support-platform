import 'dotenv/config'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ImapFlow } from 'imapflow'

/**
 * Pull mail from a real mailbox into the local pipeline.
 *
 * This is the same approach as Freshdesk's "custom mailbox" mode: instead of
 * the mail being pushed to us (MX + webhook), we connect to the mailbox and
 * fetch it. For local development that is a much better trade — no DNS, no
 * public tunnel, no account anywhere, and the laptop does not have to be
 * reachable from the internet.
 *
 * It posts the raw MIME to the SAME endpoint a real mail source would use, so
 * threading, dedupe, routing and sanitizing all behave identically. Nothing
 * here is a special case in the pipeline.
 *
 *   npm run poll:mail                      # one sweep, then exit
 *   npm run poll:mail -- --watch           # keep running, check every 15s
 *   npm run poll:mail -- --since-minutes 5 # narrow the time window
 *   npm run poll:mail -- --limit 5         # cap messages per sweep
 *   npm run poll:mail -- --all             # include already-read mail too
 *   npm run poll:mail -- --mark-seen       # also flag them read in Gmail
 *
 * Defaults are deliberately conservative: last 30 minutes, at most 20
 * messages, and your mailbox is never modified.
 *
 * Setup (Gmail/Workspace): 2-Step Verification must be on, then create an App
 * Password at https://myaccount.google.com/apppasswords and put it in .env as
 * IMAP_PASSWORD. Your normal password will NOT work.
 */

const argv = process.argv.slice(2)
const args = new Set(argv)
const watch = args.has('--watch')
const includeSeen = args.has('--all')
/** Opt-in: without this the script NEVER modifies your real mailbox. */
const markSeen = args.has('--mark-seen')

const flagValue = (name: string, fallback: number) => {
  const i = argv.indexOf(name)
  const n = i >= 0 ? Number(argv[i + 1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Safety rails. A support mailbox is usually also somebody's real inbox, so
 * the defaults are deliberately timid:
 *   - only mail from the last N minutes (not "every unread message")
 *   - never more than --limit messages in one sweep
 *   - mailbox flags are left alone unless --mark-seen is passed
 * Without these, a first run against a 357-unread inbox would open 357
 * tickets and mark 357 real emails as read, which cannot be undone.
 */
const sinceMinutes = flagValue('--since-minutes', 30)
const limit = flagValue('--limit', 20)

const host = process.env.IMAP_HOST ?? 'imap.gmail.com'
const port = Number(process.env.IMAP_PORT ?? 993)
const user = process.env.IMAP_USER ?? ''
const pass = process.env.IMAP_PASSWORD ?? ''
const mailbox = process.env.IMAP_MAILBOX ?? 'INBOX'

const apiBase = process.env.POLL_API_BASE ?? `http://localhost:${process.env.PORT ?? 8900}`
const secret = process.env.INBOUND_WEBHOOK_SECRET ?? ''

if (!user || !pass) {
  console.error(
    'IMAP_USER and IMAP_PASSWORD must be set in .env.\n' +
      'For Gmail these are your address and an App Password\n' +
      '(https://myaccount.google.com/apppasswords) — not your login password.',
  )
  process.exit(1)
}

interface Outcome {
  success: boolean
  data?: { status: string; ticketNumber?: string; ticketId?: number; reason?: string }
  error?: { message: string }
}

async function deliver(raw: Buffer, uid: number): Promise<string> {
  const res = await fetch(`${apiBase}/webhooks/email/inbound/mime`, {
    method: 'POST',
    headers: {
      'content-type': 'message/rfc822',
      'x-inbound-secret': secret,
      // The IMAP UID is stable per mailbox, so re-running the poller cannot
      // create the message twice even before the Message-ID guard sees it.
      'x-message-id': `imap-${mailbox}-${uid}`,
    },
    body: new Uint8Array(raw),
  })

  const body = (await res.json().catch(() => ({}))) as Outcome
  if (!res.ok || !body.success) {
    return `HTTP ${res.status}: ${body.error?.message ?? 'unknown error'}`
  }
  const d = body.data!
  return d.ticketNumber ? `${d.status} -> ${d.ticketNumber}` : `${d.status}${d.reason ? ` (${d.reason})` : ''}`
}

/**
 * Which UIDs this script has already delivered.
 *
 * Kept in a local file rather than by flipping the \\Seen flag, because the
 * mailbox belongs to a person, not to this tool. Re-running is safe either
 * way — the API dedupes — but this way nothing in Gmail changes.
 */
const STATE_FILE = process.env.IMAP_STATE_FILE ?? './data/.imap-processed.json'

function loadProcessed(): Set<number> {
  try {
    return new Set(JSON.parse(readFileSync(STATE_FILE, 'utf8')) as number[])
  } catch {
    return new Set()
  }
}

function saveProcessed(uids: Set<number>): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    // Keep the tail only; the UID list would otherwise grow without bound.
    writeFileSync(STATE_FILE, JSON.stringify([...uids].slice(-5000)))
  } catch (e) {
    console.warn('  (could not persist processed uids:', (e as Error).message, ')')
  }
}

const processed = loadProcessed()

async function runOnce(client: ImapFlow): Promise<number> {
  const lock = await client.getMailboxLock(mailbox)
  let handled = 0
  try {
    const since = new Date(Date.now() - sinceMinutes * 60_000)
    const criteria = includeSeen ? { since } : { seen: false, since }

    const candidates: { uid: number; source: Buffer }[] = []
    for await (const msg of client.fetch(criteria, { uid: true, source: true })) {
      if (!msg.source || processed.has(msg.uid)) continue
      candidates.push({ uid: msg.uid, source: msg.source })
    }

    if (candidates.length > limit) {
      console.log(
        `  ${candidates.length} messages match, which is over the --limit of ${limit}.\n` +
          `  Processing the ${limit} newest. Raise with --limit N if that is really what you want.`,
      )
    }

    for (const msg of candidates.slice(-limit)) {
      const result = await deliver(msg.source, msg.uid)
      console.log(`  uid ${String(msg.uid).padEnd(6)} ${result}`)
      processed.add(msg.uid)
      handled++
      if (markSeen) await client.messageFlagsAdd({ uid: String(msg.uid) }, ['\\Seen'], { uid: true })
    }

    if (handled) saveProcessed(processed)
  } finally {
    lock.release()
  }
  return handled
}

async function main() {
  if (!secret) {
    console.warn('WARNING: INBOUND_WEBHOOK_SECRET is empty; the API will reject these posts with 401.\n')
  }

  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false })
  await client.connect()
  console.log(`Connected to ${host} as ${user}, mailbox "${mailbox}"`)
  console.log(`Posting to ${apiBase}/webhooks/email/inbound/mime`)
  console.log(
    `Window: last ${sinceMinutes} min | max ${limit} per sweep | ` +
      `${includeSeen ? 'read + unread' : 'unread only'} | ` +
      `${markSeen ? 'WILL mark mail read' : 'mailbox flags untouched'}\n`,
  )

  const sweep = async () => {
    const n = await runOnce(client)
    if (n === 0) console.log(`  (nothing new in the last ${sinceMinutes} min)`)
  }

  await sweep()

  if (watch) {
    console.log('\nWatching. Send mail to this mailbox; Ctrl-C to stop.')
    const tick = setInterval(() => {
      sweep().catch((e) => console.error('poll failed:', e.message))
    }, 15_000)
    const stop = async () => {
      clearInterval(tick)
      await client.logout().catch(() => {})
      process.exit(0)
    }
    process.on('SIGINT', () => void stop())
    process.on('SIGTERM', () => void stop())
  } else {
    await client.logout()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
