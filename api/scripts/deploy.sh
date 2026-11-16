#!/usr/bin/env bash
#
# One-shot deploy to Cloudflare. Safe to re-run: every step is idempotent.
#
#   npx wrangler login          # once, first
#   ./scripts/deploy.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="support-platform"
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "Checking authentication"
npx wrangler whoami

say "Creating the D1 database (skipped if it exists)"
if npx wrangler d1 info "$DB_NAME" >/dev/null 2>&1; then
  echo "    already exists"
else
  npx wrangler d1 create "$DB_NAME"
  echo
  echo "    ^ copy the database_id above into wrangler.toml, then re-run this script."
  exit 1
fi

if grep -q 'REPLACE_WITH_D1_DATABASE_ID' wrangler.toml; then
  echo "ERROR: wrangler.toml still has the placeholder database_id."
  echo "       Run: npx wrangler d1 info $DB_NAME   and paste the uuid in."
  exit 1
fi

say "Applying migrations"
for f in migrations/*.sql; do
  echo "    $f"
  npx wrangler d1 execute "$DB_NAME" --remote --file "$f" --yes
done

say "Seeding (roles, permissions, products, admin user)"
if [ -z "${SEED_ADMIN_PASSWORD:-}" ]; then
  echo "ERROR: set SEED_ADMIN_PASSWORD first, or the default password is baked in."
  echo "       SEED_ADMIN_PASSWORD='...' ./scripts/deploy.sh"
  exit 1
fi
npm run seed:d1
npx wrangler d1 execute "$DB_NAME" --remote --file dist/seed.d1.sql --yes

say "Building the UI (served from this Worker, so no CORS)"
( cd ../support-platform && npm run build )

say "Deploying the API Worker"
npx wrangler deploy

say "Deploying the email relay Worker"
( cd workers/email-relay && npx wrangler deploy )

cat <<'DONE'

Deployed. Remaining manual steps:

  1. Secrets (each prompts for a value):
       npx wrangler secret put JWT_SECRET
       npx wrangler secret put CREDENTIALS_MASTER_KEY
       npx wrangler secret put INBOUND_WEBHOOK_SECRET
       cd workers/email-relay && npx wrangler secret put INBOUND_SECRET   # same value

  2. Point the relay at the deployed API:
       edit INGEST_URL in workers/email-relay/wrangler.toml, then redeploy it

  3. Cloudflare dashboard -> Email Routing:
       Settings -> Subdomains -> add "incomingmail"
       Routing rules -> each product address -> Send to a Worker -> support-email-relay

  4. Sign in and add a real sending provider under Admin -> Email Providers
     (Resend or SendGrid). Mailpit is local-only and will not work in production.
DONE
