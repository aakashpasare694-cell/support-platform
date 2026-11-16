-- ============================================================================
-- 0002_email_and_system — email vendor abstraction, settings, audit (SQLite)
--
-- Email vendors are configuration, never code. Credentials are stored
-- encrypted (AES-256-GCM) and decrypted only at send time.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sp_email_providers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  type                  TEXT    NOT NULL,  -- resolved through the provider registry
  name                  TEXT    NOT NULL,
  -- v1:{iv}:{ciphertext} — NEVER returned by the API
  credentials_encrypted TEXT    NULL,
  config_json           TEXT    NULL,
  is_enabled            INTEGER NOT NULL DEFAULT 1,
  is_global_default     INTEGER NOT NULL DEFAULT 0,
  -- bootstrap = seeded from secrets | admin = created in the UI
  source                TEXT    NOT NULL DEFAULT 'admin',
  sender_name           TEXT    NULL,
  sender_email          TEXT    NULL,
  last_tested_at        TEXT    NULL,
  last_test_ok          INTEGER NULL,
  last_test_detail      TEXT    NULL,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ep_default ON sp_email_providers (is_global_default, is_enabled);

CREATE TABLE IF NOT EXISTS sp_product_email_providers (
  product_id   INTEGER NOT NULL PRIMARY KEY,
  provider_id  INTEGER NOT NULL,
  sender_name  TEXT    NULL,
  sender_email TEXT    NULL,
  reply_to     TEXT    NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (product_id)  REFERENCES sp_products (id)        ON DELETE CASCADE,
  FOREIGN KEY (provider_id) REFERENCES sp_email_providers (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pep_provider ON sp_product_email_providers (provider_id);

-- How an inbound email finds its product.
CREATE TABLE IF NOT EXISTS sp_inbound_addresses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  address    TEXT    NOT NULL,
  product_id INTEGER NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES sp_products (id) ON DELETE CASCADE
);
-- MANDATORY: one address routes to exactly one product
CREATE UNIQUE INDEX IF NOT EXISTS uq_ia_address ON sp_inbound_addresses (address);

-- The idempotency table. Raw MIME is persisted before anything is parsed, so a
-- failure downstream loses nothing and the message stays replayable.
CREATE TABLE IF NOT EXISTS sp_email_ingest_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source            TEXT    NOT NULL,   -- email_worker|webhook:<provider>|dev
  provider_event_id TEXT    NULL,
  message_id        TEXT    NULL,
  dedupe_hash       TEXT    NULL,       -- sha256(message-id + from + subject + body)
  raw_r2_key        TEXT    NULL,
  status            TEXT    NOT NULL DEFAULT 'received',  -- received|processed|failed|duplicate
  ticket_id         INTEGER NULL,
  error             TEXT    NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- MANDATORY: webhook replay guard
CREATE UNIQUE INDEX IF NOT EXISTS uq_eil_event ON sp_email_ingest_log (source, provider_event_id);
-- MANDATORY: duplicate delivery guard
CREATE UNIQUE INDEX IF NOT EXISTS uq_eil_dedupe ON sp_email_ingest_log (dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_eil_status ON sp_email_ingest_log (status, created_at);

CREATE TABLE IF NOT EXISTS sp_email_delivery_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id          INTEGER NULL,
  provider_id         INTEGER NULL,
  provider_message_id TEXT    NULL,
  event               TEXT    NOT NULL,   -- delivered|bounced|complained|opened|dropped
  payload_json        TEXT    NULL,
  occurred_at         TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ede_message ON sp_email_delivery_events (message_id);
CREATE INDEX IF NOT EXISTS idx_ede_provider_msg ON sp_email_delivery_events (provider_message_id);

-- ─── System ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sp_settings (
  setting_key TEXT NOT NULL PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sp_audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER NULL,   -- NULL = system or automation
  action        TEXT    NOT NULL,
  entity_type   TEXT    NOT NULL,
  entity_id     TEXT    NULL,
  diff_json     TEXT    NULL,   -- before/after for the fields that changed
  ip            TEXT    NULL,
  user_agent    TEXT    NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON sp_audit_logs (entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON sp_audit_logs (actor_user_id, created_at);

-- Node-side queue fallback and retry bookkeeping.
CREATE TABLE IF NOT EXISTS sp_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name     TEXT    NOT NULL,
  payload_json TEXT    NOT NULL,
  run_after    TEXT    NOT NULL DEFAULT (datetime('now')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'pending',  -- pending|running|done|failed
  last_error   TEXT    NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON sp_jobs (status, run_after);

CREATE TRIGGER IF NOT EXISTS trg_email_providers_updated AFTER UPDATE ON sp_email_providers
BEGIN UPDATE sp_email_providers SET updated_at = datetime('now') WHERE id = NEW.id; END;
