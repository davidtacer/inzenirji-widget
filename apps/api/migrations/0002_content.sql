-- TASK-005/006: where each site's content lives on GitHub, and a log of every change made through the editor.

CREATE TABLE site_repos (
  site_id      TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  owner        TEXT NOT NULL,              -- GitHub owner, e.g. "davidtacer"
  repo         TEXT NOT NULL,              -- GitHub repo, e.g. "inzenirji-widget"
  dev_branch   TEXT NOT NULL,              -- test site branch, e.g. "demo/dev"
  main_branch  TEXT NOT NULL,              -- live site branch, e.g. "demo/main"
  content_root TEXT NOT NULL,              -- folder holding site.json and pages/, e.g. "apps/site/content"
  preview_url  TEXT NOT NULL,              -- hidden test site, e.g. "https://demo-dev.inzenirji.si"
  live_url     TEXT NOT NULL
);

CREATE TABLE change_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id            TEXT NOT NULL,
  email              TEXT NOT NULL,        -- who did it (registered editor of the site)
  kind               TEXT NOT NULL CHECK (kind IN ('edit', 'publish', 'undo', 'discard')),
  request            TEXT,                 -- the client's message (edit only)
  reply              TEXT,                 -- the editor's answer (edit only)
  commit_sha         TEXT,
  model              TEXT,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros        INTEGER NOT NULL DEFAULT 0, -- our AI cost in micro-euros (ADR-005)
  price_cents        INTEGER NOT NULL DEFAULT 0, -- what the client is charged, integer cents
  created_at         INTEGER NOT NULL
);
CREATE INDEX change_log_site ON change_log (site_id, created_at);
