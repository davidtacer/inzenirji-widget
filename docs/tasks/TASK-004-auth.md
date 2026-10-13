# TASK-004 — Auth: magic link login per site
Split: **004a** API + D1 + e-mail (this PR) · **004b** embed + widget login UI.
Depends on: TASK-002 (dev live)
Read first: docs/03-DECISIONS.md (ADR-005, ADR-008, ADR-009, ADR-010), docs/02-ARCHITECTURE.md

## Goal
Only e-mail addresses registered for a site can edit it. A visitor of `<site>/uredi` asks for a login link,
gets a one-time link by e-mail, and the editor gets a session bound to that one site.

## Scope (004a)
### Data (D1, `apps/api/migrations/0001_auth.sql`)
- `sites(id, name, origin, created_at)` — origin is the client site's https origin.
- `site_users(site_id, email, role[owner|editor], created_at)` — who may edit.
- `login_tokens(token_hash, site_id, email, expires_at, used_at, created_at)`.
- `sessions(token_hash, site_id, email, expires_at, created_at)`.
- `rate_limits(key, window_start, count)`.
Tokens are stored only as SHA-256 hashes. Times are integer milliseconds.

### Routes
- `POST /api/auth/request {siteId, email}` → always `202 {ok:true}` for a well-formed body (no enumeration,
  mail sent in the background so timing does not depend on the address). Sends only if the site exists and the
  e-mail is in `site_users` and limits allow. Link: `<site.origin>/uredi#login=<token>`, valid 15 min, single use.
- `POST /api/auth/exchange {siteId, token}` → `200 {sessionToken, expiresAt, siteId, email, role}` or
  `401 {error:"invalid_token"}`. Atomic single use; checks site match and that the user is still registered.
- `GET /api/auth/me?site=<id>` (Bearer) → `200 {siteId, email, role}`; `401` without/with bad session;
  `403 {error:"wrong_site"}` if the session belongs to another site.
- `POST /api/auth/logout` (Bearer) → `204`, session deleted.
- Malformed bodies → `400 {error:"invalid_request"}`. Limits exceeded → `429 {error:"rate_limited"}`
  (request: silently 202 to avoid enumeration; exchange: 429).

### Limits
Login requests: 5/hour per site+email, 20/hour per IP. Exchange: 30/hour per IP. Sessions: 30 days.

### E-mail
SMTP over Cloudflare TCP sockets (`worker-mailer`), `mail.datavallis.com:465` TLS, from `hello@inzenirji.si`,
password in Worker secret `SMTP_PASSWORD`. Slovenian text + HTML. Local dev uses a console transport that is
refused for non-localhost requests.

### Runtime
Local dev runs the real Worker (`wrangler dev`, local D1). The Node entry is removed (ADR-010).

## Tests
- Real SQLite (node:sqlite) with the real migration file for service tests; same SQL as D1.
- request: registered → 1 mail with link to site origin; unknown e-mail / unknown site / other site's user → 202, 0 mails;
  6th request in an hour → 202, no mail; malformed → 400.
- exchange: valid → session; reused → 401; expired (exactly at expiry and 1 ms after) → 401; other site → 401;
  user removed after link → 401; malformed token → 400.
- me: valid; expired session; removed user → 401; wrong site → 403; no header → 401.
- logout deletes session (me afterwards 401).
- Nothing in logs contains e-mail or token.
- Deliberate breaks: single-use check, site match on `me`.

## Must not touch
`packages/embed`, `apps/widget` (004b).

## Allowed dependencies
worker-mailer. Removing `@hono/node-server`, `tsx`.

## Acceptance criteria
All checks green; migration applies to local D1 with wrangler; local end-to-end with `wrangler dev`
(request → console mail → exchange → me → logout); after merge the deploy applies the migration to the dev D1.
