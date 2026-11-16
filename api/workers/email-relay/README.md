# Email relay Worker

Receives mail via Cloudflare Email Routing and POSTs the raw MIME to the
support platform. No database, no parsing — the API does all of that.

## Deploy

```bash
cd workers/email-relay

# 1. point it at your API (tunnel URL while developing)
#    edit INGEST_URL in wrangler.toml

# 2. the shared secret — must match INBOUND_WEBHOOK_SECRET in the API .env
npx wrangler secret put INBOUND_SECRET

# 3. ship it
npx wrangler deploy
```

## Route mail to it

Cloudflare dashboard → Email Routing → `example.com`:

1. **Settings → Subdomains** → add `in` (gives `in.example.com` its own MX,
   leaving the Google MX on the apex alone).
2. **Routing rules** → custom address `crm@in.example.com` →
   action **Send to a Worker** → `support-email-relay`.

Then forward `support@example.com` → `crm@in.example.com` in Gmail.

## Why the forward still lands on the right product

Gmail preserves the original `To:` header when forwarding. The pipeline tries
`Delivered-To` first, then `To`, then `Cc` — so a message forwarded to
`crm@in.example.com` still matches the `support@example.com` row and files
under CRM. You do not need a second inbound address.

## Checking it

```bash
npx wrangler tail support-email-relay
```

Each delivery logs `relayed <from> -> <to>: 201`.
