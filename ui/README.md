# Support Platform — UI

Front end for the centralized multi-product helpdesk (Charity ERP, Pranic Healing, CRM,
and whatever comes next).

**It talks to a real API.** The backend is a separate project at
`../support-platform-api` (Hono + SQLite); start that first or every screen will show a
connection error. There is no mock any more.

## Run it

Two processes. The API must be up first.

```bash
# terminal 1 — the API  (first run: npm run migrate && npm run seed)
cd ../support-platform-api && npm run dev      # :8900

# terminal 2 — this
npm install
npm run dev                                    # :3040
```

Vite proxies the relative `/api` base to `127.0.0.1:8900`, so there is no CORS in
development and a phone on the LAN only needs the Vite port reachable.

Node 22 is required (`.nvmrc`). On this machine the default `node` on PATH is an old
io.js build, so use `/usr/local/bin/node` or run `nvm use`.

```bash
npm run build        # typecheck + production bundle into dist/web
npm run typecheck
```

## Signing in

Real email and password against the API. `npm run seed` in the API project prints the
first administrator's credentials (`admin@support.local` by default).

**The access token lives in memory only.** On reload it is gone and the httpOnly refresh
cookie mints a new one, so a stolen `localStorage` entry is not a usable session. The
cost is one extra request on boot.

`?theme=light` / `?theme=dark` and `?design=<id>` force a theme or design direction, which
is useful for screenshots.

### What the agent sees

Ticket visibility is a **scope**, resolved per product and enforced in SQL:

| Permission | They see |
|---|---|
| `ticket.view.assigned` | Only tickets assigned to them |
| `ticket.view.team` | Tickets assigned to them or to a team they belong to |
| `ticket.view.all` | Every ticket on that product |

Broadest wins, and an agent can hold a different scope on each product. The UI mirrors it
(`canReadTickets` gates the Inbox menu) but the server is the gate — a ticket outside the
scope returns 404, so it cannot be reached by typing its id either.

## Creating a ticket

Agents can raise a ticket by hand — a phone call, a walk-in, or something they spotted
themselves. Entry points: the **New ticket** button in the top bar, **New** in the inbox
list header, or the `?new=1` deep link (bookmarkable, and the dialog strips the param on
close). All three are gated on `ticket.create`, which Read Only Agent does not have.

The dialog covers product, customer, subject, description, status, priority, source,
assignee, team and tags. Three behaviours are worth knowing:

- **Product is chosen first** because it scopes everything after it. The assignee and
  team lists only offer people with a grant on that product, and the form states which
  address replies will send from and what the ticket number will look like.
- **The customer is found or created inline.** An address already on file resolves to
  that existing profile rather than forking a duplicate — `customer_emails.email` is
  unique, and the UI honours that rather than discovering it at the API.
- **The first-response clock starts unanswered.** An agent-raised ticket has had no
  customer-facing reply, so `firstRespondedAt` stays null and the ticket shows in
  *Needs first reply* exactly like inbound email.

`tests/createTicket.test.ts` covers numbering, per-product prefixes, duplicate-email
resolution, the first message, the SLA clock and the access check in both directions
(filing into a product you cannot see is refused; a ticket created elsewhere stays
invisible). Run with `npm test`.

## Inbox layout

Views sit in a **top tab bar** with live counts and an underline on the active tab, so
identity is never colour alone. Switching tabs keeps any column filters applied — a view
and a filter answer different questions, and silently discarding a narrowing the agent
set is the kind of thing that costs trust.

Both side panes collapse independently, and every state persists per browser via
`localStorage` — an agent who works collapsed does not re-collapse it every morning.

| Pane | Toggle | Key |
|---|---|---|
| Filter rail (Saved views / Status / Priority, each group collapsible on its own) | far left of the tab bar | `[` |
| Ticket list — hiding it gives the conversation the full width | beside it, only while a ticket is open | `]` |

Two guards worth knowing. The filter toggle carries a **count badge when filters are
active**, so a collapsed rail can never hide the fact that the list is filtered. And the
ticket list **always returns when the ticket is closed** — collapsing it with nothing
selected would leave an empty screen and nothing to click, so `showList` is
`listOpen || !ticketId` rather than raw state.

The ticket header, the message thread and the composer all share one centred `max-w-3xl`
column, so nothing shifts sideways as the panes open and close, and lines stay a readable
length at full width.

## Motion and scrolling

`web/src/lib/scroll.ts` holds the scroll helpers. Every one of them checks
`prefers-reduced-motion` and falls back to an instant jump, and `styles.css` carries a
global opt-out that also flattens animations and transitions. Smooth scrolling is a
common trigger for vestibular discomfort, so it is off at the OS level rather than
buried in a settings screen.

Where it is wired:

| Interaction | Behaviour |
|---|---|
| Inbox view / filter / search changes | Ticket list glides back to the top — a different set of results should not start halfway down |
| Composer tab (Reply ↔ Private note) | Conversation scrolls to the latest message, so you compose with the thing you are answering in view |
| Sending a reply or note | Timeline follows the new message |
| Role picked on Roles & Permissions | On narrow screens the permission panel scrolls into view, since it sits below the list there |
| Any modal opening | Background scroll locks **without the sideways jump** — removing the scrollbar widens the page, so the body is padded by exactly the scrollbar width to hold the layout still. A reopened dialog starts at the top |

Containers that are moved from code carry `.scroll-smooth-area`; the rest of the app
scrolls normally, because forcing `scroll-behavior: smooth` globally makes ordinary
wheel and keyboard scrolling feel laggy.

## Design directions

Four complete directions ship in `web/src/styles.css`. Switch with the palette icon
in the top bar, or `?design=<id>`; the choice persists per browser and is applied
before first paint.

| | Direction | Character | Corners · chrome · density |
|---|---|---|---|
| `studio` | **Studio** | Balanced default — indigo on cool neutrals | 12px · soft card shadows · 10px rows |
| `graphite` | **Graphite** | Near-monochrome engineering tool, violet reserved for state | 6px · hairline borders, no shadows · 7px rows |
| `atlas` | **Atlas** | Warm paper surfaces and deep teal, calm and roomy | 16px · soft warm shadows · 14px rows |
| `contrast` | **Contrast** | Maximum legibility; borders carry the structure | 4px · no shadows, strong borders · 6px rows |

A direction is a **system**, not a palette swap. Each one sets its own surfaces, text
ramp, brand and status colours, corner radii, shadow language, list density, heading
letter-spacing and weight, chip tint strength, and chart palette — all as tokens, so
components never change.

**What a direction deliberately does *not* control:** the hue of a status, priority,
product or tag. Those are stored on the row and chosen by an administrator, so they must
mean the same thing in every theme. The direction controls how strongly they are tinted
(`--chip-tint`), not what colour they are.

### Chart palettes

Every direction's two-series chart palette was run through the six-check validator
(`dataviz` skill, `scripts/validate_palette.js`) against **its own surface, in both
modes** — lightness band, chroma floor, CVD separation, normal-vision floor, contrast.
All pass.

| Direction | Light | Dark |
|---|---|---|
| Studio | `#4f46e5` / `#0d9488` | `#8480f8` / `#0fab99` |
| Graphite | `#7c3aed` / `#0e9f6e` | `#8257f5` / `#10a37f` |
| Atlas | `#0d9488` / `#c2410c` | `#0fab99` / `#c96a10` |
| Contrast | `#1d4ed8` / `#15803d` | `#3b82f6` / `#16a34a` |

Tritan separation sits in the 6–8 band for several pairs, which is only legal with
secondary encoding — so the chart always carries a legend *and* end-of-line direct
labels, plus a table view of the same numbers.

### Adding a direction

Copy a `[data-design='…']` pair in `styles.css` (one `:not(.dark)` block, one `.dark`
block), add an entry to `DESIGNS` in `web/src/hooks/useDesign.ts`, and validate the chart
pair against the new surfaces. No component changes.

## Layout

```
web/src/
├── data/          types.ts · mock.ts (seed data) · api.ts  ← the only file that changes
│                  when the real backend lands
├── lib/           auth context, permission catalogue, formatters, cn()
├── hooks/         useTheme, useProductScope
├── components/
│   ├── ui/        Button, Avatar, Badge, Field, Menu, Modal, Toast, Feedback
│   ├── charts/    LineChart, SeriesTable, BarRow
│   └── layout/    AppShell, Sidebar, ProductSwitcher, Topbar
└── pages/         Login, Dashboard, Inbox, TicketDetail, Customers, Admin, Reports,
                   EmailProviders
```

## Decisions worth knowing

**Products are data.** Nothing branches on a product name. Colours, ticket prefixes and
support addresses all come from the product row, so a fourth product is a row, not a
deploy.

**Statuses and priorities carry semantic flags**, not meaningful names — `isOpen`,
`isResolved`, `pausesSla`. An admin can add "Waiting on Third Party" and the inbox
counts, SLA logic and reports all behave correctly without a code change.

**Public reply vs private note is the highest-stakes affordance in the app.** An internal
note has its own colour, border, a `Private` pill, and a standing
"NOT VISIBLE TO THE CUSTOMER" line; the composer repeats it while that tab is active.
Sending an internal note to a customer is the worst thing this tool could do.

**Permission codes are shared between UI and backend** (`lib/permissions.ts`). The UI
hides what the caller cannot do, but the server stays the real gate — a missing ticket
returns 404 rather than 403 so ids cannot be probed across products.

**Theming is token-only.** Every colour resolves through a CSS variable in `styles.css`;
dark mode re-declares the same tokens. `color-scheme` is bound to the app theme so native
controls do not follow the OS and render dark on a light page.

**Chart colours were validated, not eyeballed.** The two-series palette passes the
lightness band, chroma floor, CVD separation, normal-vision floor and contrast checks in
both modes. Tritan separation lands in the 6–8 band, so the chart carries a legend *and*
end-of-line direct labels as secondary encoding, plus a table view of the same numbers.

## How it talks to the API

`lib/http.ts` is the only place that knows about the envelope, the access token and the
refresh dance. It unwraps `{ success, data, meta }`, and on a 401 it refreshes once and
retries — an expired access token is invisible to the rest of the app.

Refresh is **single-flight**: refresh tokens rotate, so two concurrent calls would send
the same cookie and the second would look like a replayed token. Concurrent callers share
one in-flight promise instead.

`data/api.ts` is the only place URL strings exist. It also keeps the reference caches
(products, agents, teams, statuses, priorities, tags) that the synchronous lookups like
`productById` read from; `loadReferenceData()` fills them once at sign-in. That is why
swapping the mock for real HTTP needed almost no component changes.

One shape difference worth knowing: the ticket **list** returns a `preview` of the latest
message rather than every message body — loading full threads for a page of tickets is a
payload nobody reads. Full `messages` arrive on the detail endpoint.
