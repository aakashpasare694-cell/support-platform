# Testing the whole thing locally

Work through this top to bottom and you will have exercised every feature that
exists, plus the guards that are supposed to stop you.

Commands assume Node 22. On this machine the default `node` is an old io.js
build, so prefix with `export PATH="/usr/local/bin:$PATH"` or run `nvm use`.

---

## 0. Start everything

```bash
# terminal 1 — Mailpit, the local mail sink
mailpit                             # SMTP :1025, web UI :8025

# terminal 2 — API
cd ~/Sites/support-platform-api
npm run migrate && npm run seed     # first run only
npm run dev                         # :8900

# terminal 3 — UI
cd ~/Sites/support-platform
npm run dev                         # :3040
```

Start Mailpit **before** the API if you want replies to send on the first try.
It accepts every message and delivers none, so nothing can reach a real
customer while you are testing. Everything the app sends is readable at
<http://localhost:8025>.

Check all three are alive:

```bash
curl -s localhost:8900/health                 # {"ok":true,"env":"local"}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3040/   # 200
curl -s localhost:8025/api/v1/info | head -c 60             # {"Version":"v1.x.x",…
```

Sign in at <http://localhost:3040> as `admin@support.local` / `ChangeMe!2026`.

**A shell helper for everything below** — paste once per terminal:

```bash
login () {
  TOKEN=$(curl -s -X POST localhost:8900/api/v1/auth/login \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["accessToken"])')
  echo "signed in as $1"
}
api () { curl -s -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' "$@"; }
login admin@support.local 'ChangeMe!2026'
```

---

## 1. Authentication

| What | How | Expect |
|---|---|---|
| Good credentials | sign in via UI | lands on the dashboard |
| Wrong password | any wrong password | "That email and password do not match" |
| Unknown address | `nobody@example.com` | **the same message**, and takes the same time |
| Validation | submit `not-an-email` | 422 with the error under the field |
| Session restore | sign in, then hard-refresh (⌘⇧R) | still signed in — the refresh cookie minted a new token |
| Sign out | user menu → Sign out | back to login; refreshing does not get you back in |

```bash
curl -s -X POST localhost:8900/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@support.local","password":"wrong"}' | python3 -m json.tool
```

**Concurrency** (this used to log everyone out):

```bash
C=$(curl -s -c - -X POST localhost:8900/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@support.local","password":"ChangeMe!2026"}' | grep sp_refresh | awk '{print $7}')
curl -s -o /dev/null -w '%{http_code} ' -X POST localhost:8900/api/v1/auth/refresh -H "cookie: sp_refresh=$C" &
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8900/api/v1/auth/refresh -H "cookie: sp_refresh=$C"
wait
```
Expect **200 200** — not a 401 and not a mass logout.

---

## 2. Products

UI → **Products**.

- **Add product**: name `Test Product`, prefix `TST`, pick a colour, inbound
  address `tst@incomingmail.charityerp.com`. Save.
- It appears immediately, and the **product switcher** (top left) now lists it.
- **Edit** it: change the colour → the dot changes everywhere.
- **Deactivate** it → it disappears from the switcher and from ticket lists,
  *including for the super admin*. That is intended: a deactivated product is
  hidden from everyone.

```bash
api -X POST localhost:8900/api/v1/products \
  -d '{"name":"Test Product","ticketPrefix":"TST","color":"#0ea5e9"}' | python3 -m json.tool
```

---

## 3. Agents and per-product access

This is the part worth testing properly.

UI → **Agents → Invite agent**. Create three:

| Name | Charity ERP | CRM | Pranic Healing |
|---|---|---|---|
| Alice Manager | Support Manager | — | — |
| Bob Junior | Junior Agent | — | — |
| Carol Lead | Team Lead | Support Agent | — |

Leave the password blank — a temporary one appears **once** in the toast. Copy it.

Now sign in as each (private window, or sign out) and check:

- **Alice** sees every Charity ERP ticket, nothing from CRM or Pranic Healing.
- **Bob** sees only Charity ERP tickets **assigned to him** — initially zero.
  Assign him one as admin, and it appears.
- **Carol** sees Charity ERP tickets assigned to her **or to her teams**, plus
  the whole CRM queue.
- None of them have Products / Agents / Roles in the sidebar.

Prove the server is the gate, not the UI:

```bash
login bob@... '<temp password>'
api localhost:8900/api/v1/tickets | python3 -c 'import json,sys; print(json.load(sys.stdin)["meta"]["total"])'
api -o /dev/null -w '%{http_code}\n' localhost:8900/api/v1/tickets/9   # a Pranic ticket -> 404
api -o /dev/null -w '%{http_code}\n' -X PATCH localhost:8900/api/v1/roles/junior_agent -d '{"permissionCodes":[]}'  # 403
```

A ticket outside your scope returns **404, not 403** — a 403 would confirm it exists.

**Deactivation**: as admin, deactivate Bob. His next request fails and he is
signed out everywhere immediately, not when his token expires.

---

## 4. Teams

UI → **Teams → Create team**. Make `Technical Escalation`, no product
(cross-product), add two members.

Then set Carol's Charity ERP role to **Team Lead** and add her to a team that
owns a ticket — she should now see that ticket even though it is not assigned
to her personally. That is `ticket.view.team` doing its job.

---

## 5. Roles and permissions

UI → **Roles & Permissions**.

- Pick **Support Agent**, untick `ticket.reply`, Save.
- Sign in as a Support Agent → the Reply tab is gone and `POST /reply` returns 403.
- Put it back.
- Try to remove `role.manage` from **Super Admin** → refused, because that is
  unrecoverable from the UI.

---

## 6. Tickets

From the UI:

- **New ticket** (top right). Pick a product, search an existing customer **or**
  add a new one, fill subject + description, set priority, assign, tag. Create.
- The ticket number uses the product prefix (`ERP-5`, `TST-1`).
- **Reply** → appears in the thread, First Response turns green.
- **Private note** → amber, "NOT VISIBLE TO THE CUSTOMER", and it is *not* in
  the customer-facing thread.
- Change **status / priority / assignee** → each writes an activity line.
- **Duplicate customer check**: create a second ticket with the *same* email but
  a different name → it attaches to the existing customer, no duplicate profile.

Inbox mechanics:

- Tabs: All / Open / My tickets / Unassigned / Overdue — counts update live.
- Filter rail collapses (`[`), ticket list collapses (`]`).
- `j` / `k` move through the list, `/` focuses search.
- Filters live in the URL — copy the URL into a new tab and the view is identical.

---

## 7. Inbound email — the Freshdesk replacement

No mail server needed. Post a `.eml` straight into the pipeline.

```bash
cd ~/Sites/support-platform-api
IN='x-inbound-secret: dev-inbound-secret-abc123'

# 1. new email -> new ticket
curl -s -X POST localhost:8900/webhooks/email/inbound/mime -H "$IN" \
  --data-binary @tests/fixtures/new-ticket.eml | python3 -m json.tool
```

| Fixture / case | Expect |
|---|---|
| `new-ticket.eml` | `"status":"created"` with a ticket number |
| the same file again | `"status":"duplicate"` — not a second ticket |
| `auto-reply.eml` | `"status":"ignored"` — stops mail loops |
| `unrouted.eml` | `"status":"unrouted"` — held for an admin, never dropped |
| no `x-inbound-secret` header | **401** |

**Threading.** Reply to the new ticket from the UI, then take the outgoing
Message-ID and send a customer reply quoting it:

```bash
OURID=$(node -e "const D=require('better-sqlite3');const db=new D('./data/support-platform.db',{readonly:true});
console.log(db.prepare(\"SELECT message_id FROM sp_ticket_messages WHERE message_type='outbound_email' ORDER BY id DESC LIMIT 1\").get().message_id)")

printf 'Message-ID: <cust-reply-1@mail.test>\nFrom: Eleanor Whitfield <eleanor@northbridgetrust.org>\nTo: erp@incomingmail.charityerp.com\nIn-Reply-To: %s\nSubject: Re: anything at all\nContent-Type: text/plain\n\nStill broken.\n' "$OURID" > /tmp/r.eml

curl -s -X POST localhost:8900/webhooks/email/inbound/mime -H "$IN" --data-binary @/tmp/r.eml | python3 -m json.tool
```

Expect `"status":"appended"` with the **same ticketId**. Now edit the subject to
something completely different and resend — still `appended`, because our
Message-ID encodes the ticket.

**Sanitization.** `new-ticket.eml` contains `<script>` and a `javascript:` link.
Open the ticket in the UI: the script is gone, the dodgy link is gone, the
genuine link survives. Confirm in the database that the raw copy was kept:

```bash
node -e "const D=require('better-sqlite3');const db=new D('./data/support-platform.db',{readonly:true});
const m=db.prepare(\"SELECT body_html,body_html_sanitized FROM sp_ticket_messages WHERE body_html LIKE '%script%' LIMIT 1\").get();
console.log('raw has script:', /<script/i.test(m.body_html), '| sanitized has script:', /<script/i.test(m.body_html_sanitized)); db.close()"
```

---

## 8. Customers and reports

- **Customers** → search, open one → their emails, products and full ticket
  history, scoped to products you may see.
- **Reports** → counts, 14-day volume chart (toggle to Table), per-product and
  per-agent breakdown. Sign in as Alice and confirm the numbers shrink to her
  products only.

---

## 9. Email providers and outbound email

Mailpit is seeded as the **global default** on first `npm run seed`, from the
`DEFAULT_EMAIL_PROVIDER_*` block in `.env`. To (re-)install it on a database
that already exists:

```bash
npm run bootstrap:email -- --make-default
```

That prints every configured provider and flags any whose type has **no
registered adapter** — those will be accepted by the admin form and then fail
at send time. Right now only `mailpit` has an adapter; the `sendgrid`, `resend`
and `ses` rows in the demo data cannot send.

### Send a real reply

Open any ticket → **Reply** → send. Then:

```bash
curl -s 'localhost:8025/api/v1/messages?limit=1' | python3 -m json.tool
```

The message should be there, and the timeline pill should read **Sent**.

Check the headers that make threading work:

```bash
MID=$(curl -s 'localhost:8025/api/v1/messages?limit=1' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["messages"][0]["ID"])')
curl -s "localhost:8025/api/v1/message/$MID/headers" | python3 -m json.tool
```

Assert all four:

| Header | Expected |
|---|---|
| `Message-Id` | `<t{ticketId}.m{n}.{rand}@incomingmail.charityerp.com>` — **ours**, not one Mailpit invented |
| `In-Reply-To` | the customer's most recent message id |
| `References` | the whole chain, space separated |
| `Subject` | ends with `[#ERP-4]` — **once**, not `[#ERP-ERP-4]` |

### Close the loop — the test that matters most

Reply from the app, then feed the customer's answer back in quoting our own
Message-ID. It must **append to the same ticket**, not open a new one:

```bash
OUTID=$(curl -s 'localhost:8025/api/v1/messages?limit=1' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["messages"][0]["MessageID"])')
SECRET=$(grep '^INBOUND_WEBHOOK_SECRET=' .env | cut -d= -f2-)

printf 'From: Eleanor Whitfield <eleanor@northbridgetrust.org>\n'\
'To: erp@incomingmail.charityerp.com\n'\
'Subject: Re: Gift Aid claim is rejecting every donor\n'\
"Message-ID: <roundtrip-$(date +%s)@mail.northbridgetrust.org>\n"\
"In-Reply-To: <$OUTID>\n"\
"References: <$OUTID>\n"\
'\nRetried one claim and it went through. Thank you!\n' > /tmp/reply.eml

curl -s -X POST localhost:8900/webhooks/email/inbound/mime \
  -H "x-inbound-secret: $SECRET" --data-binary @/tmp/reply.eml
```

Expect `{"status":"appended","ticketId":14,…}`. A `"created"` here means
threading is broken.

### A failed send must never lose the reply

Stop Mailpit, then reply from the UI:

```bash
pkill -f mailpit
```

The reply still saves (HTTP 201) and the timeline shows a red **Not sent** pill
with *"The customer did not receive this."* plus the reason. This is the whole
point of committing the message before attempting delivery — a provider outage
costs an agent their place in the thread and nothing else. Restart Mailpit and
the next reply sends normally.

### Credentials are encrypted at rest

UI → **Email Providers → Add provider**. The form fields are generated from the
provider descriptor (the server publishes them at
`GET /api/v1/settings/email-provider-types`). After saving, the credential
shows **masked**.

- **Test connection** is a real round trip. With Mailpit up it reports its
  version; with Mailpit down it says so. For `resend` it correctly refuses:
  *no provider is registered for type "resend"*.
- **Make default** moves the default. Then try to disable the default → refused.

```bash
node -e "const D=require('better-sqlite3');const db=new D('./data/support-platform.db',{readonly:true});
const p=db.prepare('SELECT credentials_encrypted FROM sp_email_providers ORDER BY id DESC LIMIT 1').get();
console.log(p.credentials_encrypted.slice(0,40)+'…'); db.close()"
```

Should start `v1:` and contain nothing resembling your key.

---

## 10. Audit trail

Every admin mutation is recorded:

```bash
node -e "const D=require('better-sqlite3');const db=new D('./data/support-platform.db',{readonly:true});
for (const r of db.prepare('SELECT action,entity_type,entity_id FROM sp_audit_logs ORDER BY id DESC LIMIT 15').all())
  console.log(' ', r.action.padEnd(30), r.entity_type+'#'+r.entity_id); db.close()"
```

There is no UI for this yet — it is a database table.

---

## 11. UI polish

- **Design directions**: palette icon in the top bar — Studio / Graphite / Atlas
  / Contrast. Each changes corners, density, chrome and chart colours. Persists
  across reloads.
- **Dark mode**: moon icon. Every direction has its own dark steps.
- **Responsive**: narrow the window — panes collapse, the sidebar becomes a drawer.
- **Reduced motion**: turn on macOS → Accessibility → Display → Reduce Motion.
  Smooth scrolling and animations go instant.

---

## 12. Automated checks

```bash
cd ~/Sites/support-platform-api
npm test                 # 62 tests
npm run typecheck
npm run check:workers    # fails on an import Workers cannot load
npm run check:permissions # fails if a route wants a permission nobody can grant

cd ~/Sites/support-platform
npm run typecheck && npm run build
```

---

## 13. Starting over

```bash
cd ~/Sites/support-platform-api
rm -rf data/                      # deletes every ticket, user and setting
npm run migrate && npm run seed
```
