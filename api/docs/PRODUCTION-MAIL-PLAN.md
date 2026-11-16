# The agreed inbound mail plan

The decision, so it does not have to be re-derived:

1. The company provides the subdomain **`incomingmail.charityerp.com`**.
2. Each product's public support address **forwards** to an address on it:

   | Forward from (public) | Forward to (ingest) | Product |
   |---|---|---|
   | `support@charityerp.com` | `erp@incomingmail.charityerp.com` | Charity ERP |
   | `support@pranichealing.org` | `pranic@incomingmail.charityerp.com` | Pranic Healing |
   | `crm@healerite.com` | `crm@incomingmail.charityerp.com` | CRM |

3. Cloudflare Email Routing owns the **MX for that subdomain only**. The apex
   `charityerp.com` keeps its Google Workspace MX and is never touched.
4. A routing rule sends each address to the Worker, which parses the raw MIME
   and creates the ticket.

```
customer -> support@charityerp.com -> Google -> forward
         -> erp@incomingmail.charityerp.com
         -> Cloudflare MX (Email Routing)
         -> Worker email() handler
         -> postal-mime parses -> ingest() -> ticket
```

## No SendGrid in this plan

SendGrid was only ever a candidate for **receiving** — owning the MX. It never
did the parsing. With Cloudflare Email Routing there is no relay at all:
Cloudflare hands the Worker raw MIME and `postal-mime` parses it in-process.

SendGrid also stopped being free (plan retired May 2025, ~$20/mo after a
60-day trial), so it is the fallback, not the plan. The
`/webhooks/email/inbound/sendgrid` endpoint stays built and tested in case it
is ever needed.

## THE ONE CONDITION — read this before asking the company for anything

**Cloudflare Email Routing can only deliver to a Worker in the SAME Cloudflare
account as the zone.**

`charityerp.com` lives in the company's account. The Workers are currently in
a personal account (`cfeffea33945fbbbc45b5fd4d39187af`). As things stand, the
routing rule will not offer the Worker, and this plan cannot work.

So the request to the company is **two things, not one**:

1. The subdomain `incomingmail.charityerp.com`, with Email Routing enabled.
   (A subdomain costs nothing — it is DNS records in a zone they already own.
   Nobody needs to buy anything.)
2. **Access to the Cloudflare account**, or permission to deploy the Worker
   into it. A Workers-scoped role is enough — DNS admin is not required.

Delegating the subdomain to a separate Cloudflare account was investigated and
ruled out: that needs an Enterprise plan on the receiving account.

If access is refused, the fallback is a **separate domain in the personal
account** (~$10/year), with the same forwarding shape. Then `INGEST_DOMAIN`
and the `sp_inbound_addresses` rows change to that domain; nothing else does.

## Already configured for this hostname

- `INGEST_DOMAIN = "incomingmail.charityerp.com"` in `wrangler.toml` and `.env`
- `sp_inbound_addresses` rows for `erp@`, `pranic@`, `crm@` in production D1

Register the **public** addresses as well. Gmail preserves the original `To:`
when forwarding and the pipeline checks `Delivered-To` -> `To` -> `Cc`, so the
customer-facing address identifies the product and the routing table survives a
change of transport.
