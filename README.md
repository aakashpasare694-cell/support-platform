# Support Platform

A centralized multi-product helpdesk — one inbox for every product's support
email, with per-product access control for agents.

```
api/   Hono + Kysely + SQLite/D1   — the API, and the Cloudflare Workers entry
ui/    React + Vite + Tailwind     — the agent-facing SPA
```

## Running it locally

Three processes. Mailpit catches outgoing mail so nothing reaches a real
customer while you work.

```bash
# 1. mail sink — SMTP :1025, web UI :8025
mailpit

# 2. API — :8900
cd api
cp .env.example .env          # then fill in the secrets below
npm install
npm run migrate && npm run seed
npm run dev

# 3. UI — :3040
cd ui
npm install
npm run dev
```

Secrets you must generate yourself:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # CREDENTIALS_MASTER_KEY  (must decode to 32 bytes)
openssl rand -hex 32      # INBOUND_WEBHOOK_SECRET
```

## Getting mail in

Three transports, all normalizing to the same pipeline:

| | How | Use |
|---|---|---|
| IMAP poller | `cd api && npm run poll:mail -- --watch` | local — no DNS, no public URL |
| Cloudflare Email Routing | `api/workers/email-relay/` | production |
| Provider webhook | SendGrid / Mailgun | alternative to Cloudflare |

See [api/docs/INBOUND-EMAIL-SETUP.md](api/docs/INBOUND-EMAIL-SETUP.md).

## Testing

[api/docs/TESTING.md](api/docs/TESTING.md) walks the whole system end to end.

```bash
cd api
npm test               # 75 tests
npm run typecheck
npm run check:workers  # fails on any import Workers cannot load
npm run check:permissions
```

## Deploying

```bash
cd api
npx wrangler d1 create support-platform      # put the id in wrangler.toml
npx wrangler d1 execute support-platform --remote --file migrations/0001_init.sql
npx wrangler d1 execute support-platform --remote --file migrations/0002_email_and_system.sql

SEED_ADMIN_PASSWORD='choose-a-strong-one' npm run seed:d1
npx wrangler d1 execute support-platform --remote --file dist/seed.d1.sql

npx wrangler secret put JWT_SECRET
npx wrangler secret put CREDENTIALS_MASTER_KEY
npx wrangler secret put INBOUND_WEBHOOK_SECRET
npx wrangler deploy
```

## Known gaps

- **Outbound email only works locally.** Mailpit is the one registered provider;
  `sendgrid`/`resend`/`ses` have database rows but no adapter, so a deployed
  instance can receive mail and cannot reply.
- **Inbound threading has no requester check.** A sender who knows a ticket's
  `[#ERP-4]` token can append to it. Freshdesk guards this; we do not yet.
- Attachments are recorded but their bytes are not stored.
- No SLA escalation, automation rules, canned responses or notifications.
