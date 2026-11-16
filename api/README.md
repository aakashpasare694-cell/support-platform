# Support Platform — API

Backend for the centralized multi-product helpdesk. Separate project from the UI, which
lives at `../support-platform`.

One codebase, two runtimes: **Node.js locally, Cloudflare Workers in production**. Both
entry points build the same Hono app, so the business logic is byte-identical and only
the way it gets a database differs.

**Database: SQLite.** One file, no server to install or run. Cloudflare D1 is SQLite
too, so the schema in `migrations/` and every query in the codebase run unchanged in
production — the Workers path swaps the driver, not the dialect.

## Running it

```bash
npm install
cp .env.example .env          # set JWT_SECRET and CREDENTIALS_MASTER_KEY
npm run migrate               # creates data/support-platform.db and applies the schema
npm run seed                  # roles, permissions, statuses, products, first admin
npm run dev                   # http://localhost:8900
```

The seed prints the administrator it creates (`admin@support.local` by default — set
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` to change it). `npm run db:check` reports the
file, table count and user count when something looks wrong.

Node 22 is required (`.nvmrc`). On this machine the default `node` on PATH is an old
io.js build — use `/usr/local/bin/node` or `nvm use`.

```bash
npm test             # 39 tests: crypto, tokens, scopes, plus full-stack auth/ticket flows
npm run typecheck
npm run check:workers   # fails on an import Workers cannot load
npm run migrate:status  # which migrations are applied
```

Integration tests run the real migrations and seed against a throwaway SQLite file and
drive the real app — no server, no fixtures to keep in sync. That is the main practical
win of SQLite here beyond not needing a daemon.

## Layout

```
src/
├── index.ts            Node entry — @hono/node-server, graceful shutdown
├── index.worker.ts     Workers entry — per-request Hyperdrive scope
├── app.ts              createApp() — shared by both; the ONLY error handler
├── config/             buildConfig(env); nothing read at import time
├── db/                 schema types · node pool · hyperdrive · ALS accessor
├── http/               respond · errors · ctx (Actor, can) · validate
├── lib/                crypto (PBKDF2, AES-GCM) · jwt · cache
├── middleware/         auth (actor + grants) · requestId · rateLimit
└── modules/
    ├── auth/           login, refresh with rotation, logout, me
    ├── tickets/        repository → service → routes
    ├── customers/      repository → routes
    ├── directory/      products, agents, teams, roles
    ├── settings/       email providers (masked credentials)
    └── reports/        dashboard aggregates
```

**The rule:** `routes → service → repository`. No SQL above the repository, no HTTP
objects below the route. That is not ceremony — the repository is where product scoping
is enforced, and scattering that filter across services is exactly how a multi-tenant
leak happens.

## Endpoints

All under `/api/v1`. Every route except `/auth/login` and `/auth/refresh` needs a bearer
token.

| Method | Path | Permission |
|---|---|---|
| POST | `/auth/login` | — (rate limited) |
| POST | `/auth/refresh` | — (httpOnly cookie) |
| POST | `/auth/logout` | — |
| GET | `/auth/me` | authenticated |
| GET | `/products` | authenticated |
| GET | `/agents` · `/teams` | `agent.view` |
| GET | `/roles` | `role.manage` |
| GET | `/tickets` | any ticket view scope |
| GET | `/tickets/meta` | authenticated |
| GET | `/tickets/:id` | any ticket view scope |
| POST | `/tickets` | `ticket.create` **on that product** |
| POST | `/tickets/:id/reply` | `ticket.reply` |
| POST | `/tickets/:id/notes` | `ticket.note` |
| PATCH | `/tickets/:id` | per field: `ticket.status.change`, `.priority.change`, `.assign.self` / `.assign.others`, `.tag` |
| GET | `/customers` · `/customers/:id` | `customer.view` |
| GET | `/settings/email-providers` | `settings.email_providers.manage` |
| POST | `/settings/email-providers/:id/test` | `settings.email_providers.manage` |
| GET | `/reports/overview` | `report.view` |

### One envelope, real status codes

```json
{ "success": true,  "data": {}, "meta": { "page": 1, "perPage": 25, "total": 134 } }
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "…", "details": { "email": "…" } }, "requestId": "…" }
```

Failures are built in exactly one place — the `onError` handler in `app.ts`. Services
throw typed `AppError` subclasses and that handler translates them. Routes pass
`envelopeValidation` to `zValidator`, because its default behaviour is to answer with a
raw `ZodError` that bypasses the handler entirely.

## Permissions

A grant is a **role ON a product** (`sp_user_product_roles`); `product_id IS NULL` means
every product. There is no `is_admin` flag that can drift out of sync, and an agent can
hold a different role on each product.

### Ticket visibility is a scope, not a flag

Three permissions, resolved per product, **broadest wins**:

| Permission | They see |
|---|---|
| `ticket.view.assigned` | Only tickets where they are the assignee |
| `ticket.view.team` | Tickets assigned to them **or** to a team they belong to |
| `ticket.view.all` | Every ticket on that product |

This is enforced in SQL, not applied as a filter the client could widen. `baseQuery`
builds one OR-branch per scope group:

```sql
   product_id IN (all-scope products)
OR (product_id IN (team-scope)     AND (assignee_id = :me OR team_id IN (:my_teams)))
OR (product_id IN (assigned-scope) AND assignee_id = :me)
```

With no group populated it collapses to `product_id IN (-1)` — matching nothing, which is
the safe direction. `getTicket` uses the same predicate, so a ticket hidden from the queue
is also unreachable by id.

A realistic setup: an agent is `ticket.view.all` on CRM, `ticket.view.team` on Charity ERP
and has no grant at all on Pranic Healing. One list endpoint, one query, three different
answers.

### The catalogue

49 permissions in eight groups, seeded from `scripts/seed.ts` and served by `GET /roles`
so the admin UI renders itself from the database rather than a hardcoded list.

| Group | Covers |
|---|---|
| Ticket access | the three visibility scopes above |
| Tickets | create, reply, note, assign (self vs others), status, priority, tag, reopen, merge, spam, delete, export |
| Attachments | download, upload, delete |
| Customers | view, create, manage, merge, delete |
| Administration | products, agents (incl. deactivate), teams, roles — each with view/manage split |
| Settings | email providers, inbound addresses, general, tags, automation, SLA, canned responses (own vs shared) |
| Insights | own stats vs all reports, export, audit log |

Two splits worth calling out, because collapsing them is the common mistake:

- **`ticket.assign.self` vs `ticket.assign.others`** — a junior agent can usually take a
  ticket but should not be able to push work onto someone else.
- **`report.view.own` vs `report.view`** — agents seeing their own numbers is normal;
  seeing everyone's is a management privilege.

Seeded roles: **Super Admin, Admin, Support Manager, Support Agent, Team Lead**
(`ticket.view.team`), **Junior Agent** (`ticket.view.assigned`) and **Read Only Agent**.
The seed replaces each role's grant set and prunes permissions that left the catalogue, so
a rename cannot leave a dead permission granted to somebody.

## Decisions worth knowing

**Product scoping is a required argument.** Every ticket read takes `productIds`, and it
is not optional — forgetting the filter is a type error rather than a cross-product leak.
A ticket outside your products returns **404, never 403**: a 403 would confirm the id
exists and let someone enumerate another product's tickets.

**Grants are the only admin concept.** A row in `sp_user_product_roles` grants a role ON
a product; `product_id IS NULL` means every product. There is no `is_admin` flag that can
drift out of sync. A global grant resolves to every *active* product, so deactivating a
product hides it from everyone, super admins included.

**Password hashing is PBKDF2-SHA256 via WebCrypto**, 600k iterations, parameters recorded
in the hash so they can be raised later without locking anyone out. bcrypt and argon2 are
native modules and cannot run on Workers — that is a constraint, not a preference, and
`npm run check:workers` fails the build if anyone adds them.

**Refresh tokens rotate and detect replay.** Only a SHA-256 hash is stored. Presenting an
already-revoked token means it leaked, so every session for that user is killed rather
than just refusing the one request.

**Provider credentials are AES-256-GCM**, decrypted only to mask for the settings screen.
The version prefix (`v1:`) is what makes key rotation possible later.

**Login timing is constant.** An unknown email still runs a PBKDF2 verification against a
null hash, so a missing account and a wrong password take the same time.

**Rate limiting fails open.** A cache outage must make the API unprotected rather than
unavailable — the right trade for an internal tool, worth revisiting if this is ever
exposed publicly.

**Refresh rotation has a grace window.** Rotation plus strict reuse-detection has a
false-positive problem: two tabs waking at once, a retried request, or React's
double-invoked effects send the same cookie twice before the replacement lands. Treating
that as theft revoked every session the user had. Inside `ROTATION_GRACE_MS` (20s) a
re-presented token is re-issued instead; outside it, reuse is still treated as theft. The
client also single-flights refresh so concurrent callers share one request.

**SQLite pragmas that matter:** WAL (so reads continue during a write), `foreign_keys = ON`
(SQLite ignores FK clauses without it, per connection) and a 5s busy timeout.

## Testing

A full local walkthrough of every feature, including the per-product permission
scopes and the inbound email pipeline: [docs/TESTING.md](docs/TESTING.md)

## Receiving real mail

`erp@incomingmail.charityerp.com` is a row in `sp_inbound_addresses`, not a mailbox.
Before mail can arrive, the subdomain needs an MX record pointing at something that
accepts mail and calls our webhook, and `support@charityerp.com` needs to forward there.

**`charityerp.com` already runs Google Workspace on the apex MX — do not change those.**
The setup works on the `incomingmail.` subdomain so company email is untouched.

Full steps, including the DNS records and the Google Workspace forward:
[docs/INBOUND-EMAIL-SETUP.md](docs/INBOUND-EMAIL-SETUP.md)

## Deploying to Workers

D1 is SQLite, so the migrations apply as-is:

```bash
wrangler d1 create support-platform          # put the id in wrangler.toml
wrangler d1 execute support-platform --file migrations/0001_init.sql
wrangler d1 execute support-platform --file migrations/0002_email_and_system.sql
```

`src/index.worker.ts` still needs a D1 dialect (`kysely-d1`) wired to `env.DB` — it is
scaffolded, not yet exercised. Local development goes through `src/index.ts`.

## Email providers

Vendors are resolved through a registry (`src/modules/email/providers/registry.ts`);
no vendor name appears in business logic. Adding one is a file implementing
`EmailProvider` plus a `register()` call — the admin credential form renders itself
from the definition's `credentialFields`, published at
`GET /settings/email-provider-types`.

**Registered today: `mailpit` only.** Mailpit is the local sink — it accepts every
message and delivers none, so testing cannot reach a real customer. It is driven over
Mailpit's HTTP send API rather than SMTP, because SMTP needs a raw TCP socket that
Workers cannot open; `fetch` keeps one code path for both runtimes.

```bash
mailpit                                  # SMTP :1025, UI :8025
npm run bootstrap:email -- --make-default
```

`sendgrid`, `resend` and `ses` have schema rows and UI entries but **no adapter**, so
they will fail at send time until one is written. `npm run bootstrap:email` lists every
provider and flags exactly that.

## What is not built yet

Phases 10 and 11 of the plan — SLA and automation, and collaboration — plus:

- **Delivery events.** Outbound send works and records `sent` / `failed` with a reason,
  but nothing consumes provider bounce webhooks into `sp_email_delivery_events`, so
  `bounced` and `complained` are never set by anything but a manual update.
- **Attachments.** Inbound attachment rows are recorded with a `pending/` key; the
  bytes are not stored, and the composer cannot attach anything outbound.
- **Queue.** Both ingest and send run inline. Fine at this volume; a slow provider
  holds the agent's request open for the duration of one HTTP call.
- **Real vendor adapters** for production sending, and SPF/DKIM/DMARC on the domain —
  see [docs/INBOUND-EMAIL-SETUP.md](docs/INBOUND-EMAIL-SETUP.md).

## Connecting the UI

The UI's `web/src/data/api.ts` is the seam: it already declares the same paths in its
`ENDPOINTS` map and returns the same shapes from a local mock. Two differences to expect
when wiring it up:

- the list endpoint returns `lastMessage` (a preview) rather than every message body —
  loading full threads for a page of tickets is a payload nobody reads;
- responses are wrapped in `{ success, data, meta }`, so the client unwraps `data`.
