-- TASK-009 (ADR-014): prepaid credit per site, in integer euro cents incl. VAT.
CREATE TABLE credit_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('grant', 'topup', 'charge', 'adjust')),
  amount_cents INTEGER NOT NULL,            -- + adds credit, − uses it (gross, VAT included)
  net_cents    INTEGER,                     -- top-ups: amount without VAT
  vat_cents    INTEGER,                     -- top-ups: VAT part
  ref          TEXT,                        -- top-up: Stripe Checkout session id; charge: change_log id
  email        TEXT,                        -- who triggered it
  created_at   INTEGER NOT NULL
);
CREATE INDEX credit_ledger_site ON credit_ledger (site_id, created_at);
-- The starting credit is granted once per site.
CREATE UNIQUE INDEX credit_ledger_one_grant ON credit_ledger (site_id) WHERE kind = 'grant';
-- A Stripe payment is credited once, however often the webhook is delivered.
CREATE UNIQUE INDEX credit_ledger_topup_ref ON credit_ledger (ref) WHERE kind = 'topup';
