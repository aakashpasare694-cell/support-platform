# Receiving mail: what to configure where

As shipped, `erp@incomingmail.charityerp.com` is only a row in `sp_inbound_addresses`.
Nothing can deliver to it yet. Two things have to be true before mail arrives:

1. the subdomain `incomingmail.charityerp.com` has a **mail receiver** (an MX record
   pointing at something that accepts mail and calls our webhook);
2. `support@charityerp.com` **forwards** to an address on that subdomain.

## The constraint that decides the approach

`charityerp.com` already has Google Workspace MX records on the apex:

```
aspmx.l.google.com, alt1/alt2.aspmx.l.google.com, aspmx2/3.googlemail.com
```

**Do not touch those.** Changing apex MX breaks all company email. Everything below
works on the `incomingmail.` subdomain, which has its own MX and leaves Google alone.

DNS is already on Cloudflare, so these records go in the Cloudflare dashboard.

---

## Option A — Cloudflare Email Routing + Email Worker (recommended)

Free, vendor-neutral, and it is the same platform the API deploys to. Email Routing
**does** work on a subdomain — Cloudflare added subdomain support, so Google Workspace
on the apex is untouched.

**1. Add the subdomain** — Cloudflare dashboard → your account → **Email Routing**
(newer dashboards: **Compute → Email Service → Email Routing**) → select
`charityerp.com` → **Settings** → **Subdomains** → add `incomingmail`.

Cloudflare writes the MX records itself (`route1/route2/route3.mx.cloudflare.net`) on
the **subdomain only**. Verify afterwards:

```bash
dig +short MX incomingmail.charityerp.com     # expect route1/2/3.mx.cloudflare.net
dig +short MX charityerp.com                  # MUST still be Google's aspmx hosts
```

**2. Deploy the Worker, then route each address to it** — Email Routing →
**Routing rules** → create one rule per product, action **Send to a Worker**:

| Custom address | Worker |
|---|---|
| `erp@incomingmail.charityerp.com` | `support-platform-api` |
| `pranic@incomingmail.charityerp.com` | `support-platform-api` |
| `crm@incomingmail.charityerp.com` | `support-platform-api` |
| `pune@incomingmail.charityerp.com` | `support-platform-api` |

The Worker's `email()` handler (`src/index.worker.ts`) receives the raw MIME and calls
the same `ingest()` as every other source.

> **Catch-all is apex-only.** On a subdomain each address needs its own literal rule,
> so adding a fifth product means adding a rule as well as a row. Arguably safer than
> a catch-all, which would ingest every typo and spam address.

**3. Google Workspace** — repoint the support mailbox's forward (see step 3 of Option B;
it is identical).

Two caveats before committing to this path:
- The Workers deployment still needs `kysely-d1` wired to `env.DB` — until then the
  Worker has no database and `email()` rejects (which makes the sender retry rather
  than lose the mail).
- Cloudflare's docs confirm subdomain routing rules but do not explicitly document
  *Send to a Worker* on a subdomain address. If that action is unavailable in the
  dashboard, fall back to Option B, which has no such question.

---

## Option B — SendGrid Inbound Parse

Works on a subdomain, so Google Workspace is untouched. One MX record accepts **every**
address on that subdomain, which is exactly what per-product routing needs — and unlike
Option A there is no per-address rule to create. Needs a SendGrid account, and the
API must be reachable on a public HTTPS URL.

**1. DNS** — Cloudflare → charityerp.com → DNS → Add record

| Type | Name | Mail server | Priority |
|---|---|---|---|
| MX | `incomingmail` | `mx.sendgrid.net` | 10 |

MX records are never proxied. An existing wildcard `*.charityerp.com` A record does not
interfere — mail routing only reads MX.

**2. SendGrid** — Settings → Inbound Parse → Add Host & URL

- Receiving domain: `incomingmail.charityerp.com`
- Destination URL: `https://<your-api-host>/webhooks/email/inbound/sendgrid`
- Tick **POST the raw, full MIME message** — the parsed-field mode drops headers that
  threading depends on.

**3. Google Workspace** — the support mailbox → Forwarding

Change the existing forward from the Freshdesk address to:

```
support@charityerp.com   →   erp@incomingmail.charityerp.com
```

Keep "also keep a copy in the inbox" on until you trust the new system.

Repeat per product: `pranic@`, `crm@`, `pune@` — all accepted by the same MX.

## Option C — Mailgun Routes

Same shape as SendGrid: MX on the subdomain (`mxa.mailgun.org`, `mxb.mailgun.org`,
priority 10) and a Route that forwards to
`https://…/webhooks/email/inbound/mailgun`.

---

## Trying it before changing any DNS

The pipeline does not care how the bytes arrive:

```bash
# expose the local API
cloudflared tunnel --url http://localhost:8900

# point ONE test forward (or a SendGrid sandbox) at the tunnel URL:
#   https://<random>.trycloudflare.com/webhooks/email/inbound/sendgrid

# or skip mail entirely and post a .eml straight in:
curl -X POST http://localhost:8900/webhooks/email/inbound-dev/eml \
  --data-binary @tests/fixtures/new-ticket.eml
```

## Secrets

```bash
openssl rand -base64 32      # -> INBOUND_WEBHOOK_SECRET
```

The webhook rejects anything without it (401). Treat it like a password: whoever has
the URL and the secret can create tickets.

## Sending replies back out

Replies **do** send now, through the provider registry. Locally that means Mailpit:
start it with `mailpit`, and every reply the app sends is readable at
<http://localhost:8025> instead of reaching anyone. A reply whose provider is
unreachable is still saved, marked `failed` with the reason, and flagged red on the
timeline — it is never silently dropped.

Going to production needs two more things: an adapter for a real vendor (only
`mailpit` is registered today), and domain authorization. For replies to leave *as*
`support@charityerp.com` without landing in spam:

- **SPF** — `charityerp.com` currently has **no SPF record**. It will need one covering
  both Google and the sending provider, e.g.
  `v=spf1 include:_spf.google.com include:sendgrid.net ~all`
- **DKIM** — publish the provider's signing key as a CNAME/TXT.
- **DMARC** — add `_dmarc` once SPF and DKIM pass.

Outgoing `Message-ID`s are stamped `<t{ticket}.m{n}.{rand}@incomingmail.charityerp.com>`
and the customer's reply is matched back on that id, so threading does not depend on
the subject line surviving. The `[#ERP-4]` subject token is the fallback for a client
that strips headers.
