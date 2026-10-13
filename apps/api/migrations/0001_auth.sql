-- TASK-004a: sites, editors, login links, sessions, rate limits. Times are integer milliseconds (UTC).
-- Tokens are never stored in clear text, only as lowercase hex SHA-256.

CREATE TABLE sites (
  id         TEXT PRIMARY KEY,           -- site id, e.g. "hisa-denk"
  name       TEXT NOT NULL,              -- shown in e-mails, e.g. "Hiša Denk"
  origin     TEXT NOT NULL,              -- client site origin, e.g. "https://hisa-denk.si"
  created_at INTEGER NOT NULL
);

CREATE TABLE site_users (
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,              -- stored lowercase, trimmed
  role       TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, email)
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_tokens_expires ON login_tokens (expires_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_site_email ON sessions (site_id, email);

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,         -- e.g. "login-email:<sha256>" or "login-ip:<sha256>"
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
