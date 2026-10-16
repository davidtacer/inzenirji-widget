-- TASK-016 (ADR-015): public editor demo. Every visitor gets a private sandbox copy of the demo site's content
-- in this table (never in git). Content is cleared after 24 hours; the row is kept 90 days for the funnel numbers.
CREATE TABLE demo_sandboxes (
  token_hash    TEXT PRIMARY KEY,          -- SHA-256 of the visitor's sandbox token (kept only in their browser)
  content       TEXT,                      -- {"site":…,"pages":{…}} as JSON; NULL once expired
  edits         INTEGER NOT NULL DEFAULT 0,
  email         TEXT,                      -- given to unlock more edits (a lead for the CRM)
  website       TEXT,                      -- optional: the visitor's own website
  ip_hash       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  first_edit_at INTEGER,
  email_at      INTEGER,
  lead_sent_at  INTEGER                    -- when the CRM accepted the lead
);
CREATE INDEX demo_sandboxes_created ON demo_sandboxes (created_at);
CREATE INDEX demo_sandboxes_lead ON demo_sandboxes (email_at) WHERE email_at IS NOT NULL AND lead_sent_at IS NULL;

CREATE TABLE demo_edits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL,
  request     TEXT NOT NULL,
  reply       TEXT NOT NULL,
  changed     INTEGER NOT NULL,
  model       TEXT NOT NULL,
  cost_micros INTEGER NOT NULL,            -- AI cost in micro-euros (ADR-005)
  created_at  INTEGER NOT NULL
);
CREATE INDEX demo_edits_created ON demo_edits (created_at);
CREATE INDEX demo_edits_sandbox ON demo_edits (token_hash, id);
