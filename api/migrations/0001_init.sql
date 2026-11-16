-- ============================================================================
-- 0001_init — centralized multi-product support platform (SQLite)
--
-- Design rules enforced by this schema:
--   * SHARED tables across all products. Never a table set per product.
--   * Every product-scoped row carries product_id.
--   * Statuses/priorities carry SEMANTIC FLAGS (is_open, pauses_sla, ...) so
--     business logic never keys off a name an admin can rename.
--   * product_id IS NULL on sp_user_product_roles means "all products".
--
-- SQLite notes: booleans are INTEGER 0/1, timestamps are TEXT in
-- 'YYYY-MM-DD HH:MM:SS' UTC, and JSON columns are TEXT holding JSON.
-- ============================================================================

-- ─── Identity & access ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sp_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  -- PBKDF2-SHA256 via WebCrypto: pbkdf2$iterations$salt_b64$hash_b64
  password_hash TEXT    NULL,
  avatar_color  TEXT    NULL,
  job_title     TEXT    NULL,
  timezone      TEXT    NOT NULL DEFAULT 'UTC',
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT    NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- MANDATORY: login identity
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON sp_users (email);

CREATE TABLE IF NOT EXISTS sp_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT    NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- blocks deletion; the permission set stays editable
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_code ON sp_roles (code);

CREATE TABLE IF NOT EXISTS sp_permissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT    NOT NULL,   -- resource.action, e.g. ticket.reply
  permission_group TEXT    NOT NULL,   -- UI grouping only
  label            TEXT    NOT NULL,
  description      TEXT    NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_permissions_code ON sp_permissions (code);

CREATE TABLE IF NOT EXISTS sp_role_permissions (
  role_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id)       REFERENCES sp_roles (id)       ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES sp_permissions (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rp_permission ON sp_role_permissions (permission_id);

CREATE TABLE IF NOT EXISTS sp_products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- stable machine key; NEVER branched on in business logic
  code          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  slug          TEXT    NOT NULL,
  description   TEXT    NULL,
  color         TEXT    NOT NULL DEFAULT '#0f62fe',
  ticket_prefix TEXT    NOT NULL,   -- e.g. ERP -> ERP-1024
  is_active     INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT    NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_code ON sp_products (code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_slug ON sp_products (slug);

-- The single mechanism behind BOTH product access and RBAC.
-- product_id NULL + an admin role == global access. There is deliberately no
-- separate is_admin flag that could drift out of sync with this table.
CREATE TABLE IF NOT EXISTS sp_user_product_roles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  product_id INTEGER NULL,          -- NULL = all products (global grant)
  role_id    INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id)    REFERENCES sp_users (id)    ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES sp_products (id) ON DELETE CASCADE,
  FOREIGN KEY (role_id)    REFERENCES sp_roles (id)    ON DELETE CASCADE
);
-- MANDATORY: makes a repeated grant idempotent
CREATE UNIQUE INDEX IF NOT EXISTS uq_upr ON sp_user_product_roles (user_id, product_id, role_id);
CREATE INDEX IF NOT EXISTS idx_upr_product ON sp_user_product_roles (product_id);

CREATE TABLE IF NOT EXISTS sp_teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NULL,   -- NULL = cross-product team, e.g. Technical Support
  name        TEXT    NOT NULL,
  description TEXT    NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES sp_products (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_teams_product ON sp_teams (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_name ON sp_teams (product_id, name);

CREATE TABLE IF NOT EXISTS sp_team_members (
  team_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tm_user ON sp_team_members (user_id);

CREATE TABLE IF NOT EXISTS sp_refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  -- sha256 of the opaque token; the token itself is never stored
  token_hash TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  revoked_at TEXT    NULL,
  user_agent TEXT    NULL,
  ip         TEXT    NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES sp_users (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rt_hash ON sp_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_rt_user ON sp_refresh_tokens (user_id, expires_at);

-- ─── Customers ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sp_customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  company    TEXT    NULL,
  phone      TEXT    NULL,
  timezone   TEXT    NULL,
  notes      TEXT    NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A customer is GLOBAL; the product association is a row. One person emailing
-- about two products is one profile with two associations.
CREATE TABLE IF NOT EXISTS sp_customer_emails (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  email       TEXT    NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES sp_customers (id) ON DELETE CASCADE
);
-- MANDATORY: inbound sender -> customer resolution, and the duplicate guard
CREATE UNIQUE INDEX IF NOT EXISTS uq_ce_email ON sp_customer_emails (email);
CREATE INDEX IF NOT EXISTS idx_ce_customer ON sp_customer_emails (customer_id);

CREATE TABLE IF NOT EXISTS sp_customer_products (
  customer_id   INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  first_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_id, product_id),
  FOREIGN KEY (customer_id) REFERENCES sp_customers (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES sp_products (id)  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cp_product ON sp_customer_products (product_id);

-- ─── Ticket vocabulary (semantic flags, not names) ──────────────────────────

CREATE TABLE IF NOT EXISTS sp_ticket_statuses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#6b7280',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_open     INTEGER NOT NULL DEFAULT 1,  -- counts as open in the inbox
  is_resolved INTEGER NOT NULL DEFAULT 0,  -- stops the resolution clock
  pauses_sla  INTEGER NOT NULL DEFAULT 0,  -- waiting on someone else
  is_default  INTEGER NOT NULL DEFAULT 0   -- applied to new tickets
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ts_code ON sp_ticket_statuses (code);

CREATE TABLE IF NOT EXISTS sp_ticket_priorities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  weight     INTEGER NOT NULL DEFAULT 0,   -- higher = more urgent
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tp_code ON sp_ticket_priorities (code);

-- ─── Tickets ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sp_product_counters (
  product_id  INTEGER NOT NULL PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES sp_products (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sp_tickets (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number          TEXT    NOT NULL,   -- {prefix}-{n}
  product_id             INTEGER NOT NULL,
  customer_id            INTEGER NULL,
  subject                TEXT    NOT NULL,
  status_id              INTEGER NOT NULL,
  priority_id            INTEGER NOT NULL,
  assignee_id            INTEGER NULL,
  team_id                INTEGER NULL,
  source                 TEXT    NOT NULL DEFAULT 'email',  -- email|manual|api|portal
  sla_policy_id          INTEGER NULL,
  fr_due_at              TEXT    NULL,       -- first-response deadline
  resolution_due_at      TEXT    NULL,
  first_responded_at     TEXT    NULL,
  resolved_at            TEXT    NULL,
  closed_at              TEXT    NULL,
  last_customer_reply_at TEXT    NULL,
  last_agent_reply_at    TEXT    NULL,
  last_activity_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  merged_into_ticket_id  INTEGER NULL,
  is_spam                INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id)  REFERENCES sp_products (id),
  FOREIGN KEY (customer_id) REFERENCES sp_customers (id) ON DELETE SET NULL,
  FOREIGN KEY (status_id)   REFERENCES sp_ticket_statuses (id),
  FOREIGN KEY (priority_id) REFERENCES sp_ticket_priorities (id),
  FOREIGN KEY (assignee_id) REFERENCES sp_users (id) ON DELETE SET NULL,
  FOREIGN KEY (team_id)     REFERENCES sp_teams (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_number ON sp_tickets (ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_product_status ON sp_tickets (product_id, status_id, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON sp_tickets (assignee_id, status_id);
CREATE INDEX IF NOT EXISTS idx_tickets_team ON sp_tickets (team_id, status_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON sp_tickets (customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_fr_due ON sp_tickets (fr_due_at);
CREATE INDEX IF NOT EXISTS idx_tickets_resolution_due ON sp_tickets (resolution_due_at);

CREATE TABLE IF NOT EXISTS sp_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NULL,   -- NULL = global tag
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#6b7280',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES sp_products (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_scope ON sp_tags (product_id, name);

CREATE TABLE IF NOT EXISTS sp_ticket_tags (
  ticket_id INTEGER NOT NULL,
  tag_id    INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, tag_id),
  FOREIGN KEY (ticket_id) REFERENCES sp_tickets (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)    REFERENCES sp_tags (id)    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tt_tag ON sp_ticket_tags (tag_id);

CREATE TABLE IF NOT EXISTS sp_ticket_messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id           INTEGER NOT NULL,
  message_type        TEXT    NOT NULL,                      -- inbound_email|outbound_email|note
  visibility          TEXT    NOT NULL DEFAULT 'public',     -- public|private
  author_user_id      INTEGER NULL,                          -- NULL for inbound customer email
  from_name           TEXT    NULL,
  from_address        TEXT    NULL,
  to_json             TEXT    NULL,
  cc_json             TEXT    NULL,
  bcc_json            TEXT    NULL,
  subject             TEXT    NULL,
  body_html           TEXT    NULL,   -- raw as received — NEVER rendered unsanitized
  body_html_sanitized TEXT    NULL,   -- allowlist-sanitized; this is what the UI renders
  body_text           TEXT    NULL,
  message_id          TEXT    NULL,   -- RFC Message-ID
  in_reply_to         TEXT    NULL,
  message_references  TEXT    NULL,
  provider_id         INTEGER NULL,
  provider_message_id TEXT    NULL,
  delivery_status     TEXT    NULL,   -- queued|sent|delivered|bounced|complained|failed
  delivery_detail     TEXT    NULL,
  raw_r2_key          TEXT    NULL,   -- original MIME; makes a message replayable
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id)      REFERENCES sp_tickets (id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES sp_users (id)   ON DELETE SET NULL
);
-- MANDATORY, not tuning: THIS IS THE DEDUPE GUARD for inbound email
CREATE UNIQUE INDEX IF NOT EXISTS uq_tm_message_id ON sp_ticket_messages (message_id);
CREATE INDEX IF NOT EXISTS idx_tm_ticket ON sp_ticket_messages (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tm_provider_msg ON sp_ticket_messages (provider_message_id);

CREATE TABLE IF NOT EXISTS sp_attachments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NULL,
  ticket_id       INTEGER NOT NULL,
  product_id      INTEGER NOT NULL,
  filename        TEXT    NOT NULL,
  content_type    TEXT    NOT NULL,
  size_bytes      INTEGER NOT NULL,
  checksum_sha256 TEXT    NULL,
  r2_key          TEXT    NOT NULL,
  is_inline       INTEGER NOT NULL DEFAULT 0,
  content_id      TEXT    NULL,   -- cid: reference for inline images
  uploaded_by_id  INTEGER NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id)  REFERENCES sp_tickets (id)         ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES sp_ticket_messages (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_att_ticket ON sp_attachments (ticket_id);
CREATE INDEX IF NOT EXISTS idx_att_message ON sp_attachments (message_id);
CREATE INDEX IF NOT EXISTS idx_att_key ON sp_attachments (r2_key);

CREATE TABLE IF NOT EXISTS sp_ticket_activities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     INTEGER NOT NULL,
  actor_user_id INTEGER NULL,   -- NULL = system/automation
  action        TEXT    NOT NULL,
  field         TEXT    NULL,
  old_value     TEXT    NULL,
  new_value     TEXT    NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES sp_tickets (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ta_ticket ON sp_ticket_activities (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS sp_ticket_relations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id         INTEGER NOT NULL,
  related_ticket_id INTEGER NOT NULL,
  relation_type     TEXT    NOT NULL,   -- related|duplicate|merged
  created_by_id     INTEGER NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id)         REFERENCES sp_tickets (id) ON DELETE CASCADE,
  FOREIGN KEY (related_ticket_id) REFERENCES sp_tickets (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tr ON sp_ticket_relations (ticket_id, related_ticket_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_tr_related ON sp_ticket_relations (related_ticket_id);

CREATE TABLE IF NOT EXISTS sp_ticket_watchers (
  ticket_id INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, user_id),
  FOREIGN KEY (ticket_id) REFERENCES sp_tickets (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES sp_users (id)   ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tw_user ON sp_ticket_watchers (user_id);

CREATE TABLE IF NOT EXISTS sp_saved_views (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  product_id    INTEGER NULL,
  name          TEXT    NOT NULL,
  icon          TEXT    NULL,
  is_shared     INTEGER NOT NULL DEFAULT 0,
  filters_json  TEXT    NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES sp_users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sv_owner ON sp_saved_views (owner_user_id);

-- SQLite has no ON UPDATE CURRENT_TIMESTAMP, so the tables that carry an
-- updated_at get a trigger rather than relying on every writer to remember.
CREATE TRIGGER IF NOT EXISTS trg_users_updated AFTER UPDATE ON sp_users
BEGIN UPDATE sp_users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_products_updated AFTER UPDATE ON sp_products
BEGIN UPDATE sp_products SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_customers_updated AFTER UPDATE ON sp_customers
BEGIN UPDATE sp_customers SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_tickets_updated AFTER UPDATE ON sp_tickets
BEGIN UPDATE sp_tickets SET updated_at = datetime('now') WHERE id = NEW.id; END;
