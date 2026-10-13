# API — `apps/api`

Status: health **Live** on dev; auth **Built** (TASK-004a; live after merge + deploy).

## Structure
- `src/worker.ts` — Cloudflare Worker entry. Builds the app per request from the Worker env: D1 binding `DB`,
  mail transport (`selectMailer`), `ctx.waitUntil` for background work. Without `DB`, a usable mailer or `ctx`,
  `/api/auth/*` answers `503 auth_unavailable`.
- `src/app.ts` — `createApp({ version, auth? })`: Hono app under `/api`, JSON 404/500.
- `src/auth/routes.ts` — HTTP layer: body validation (zod contracts in `packages/shared/src/auth.ts`), bearer parsing.
- `src/auth/service.ts` — login links, exchange, sessions, rate limits (all SQL lives here).
- `src/mailer.ts` — `smtpMailer` (worker-mailer over Cloudflare TCP sockets, `LogLevel.NONE`), `consoleMailer`
  (local only), `loginEmail` (Slovenian text + HTML, site name HTML-escaped).
- `src/db.ts` — the D1 subset used; `src/testing/sqlite-d1.ts` — node:sqlite adapter for tests, applies the real migrations.
- `migrations/` — D1 migrations, applied by `wrangler d1 migrations apply` (locally by `pnpm dev`, on dev by the deploy).

## Routes
| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/health` | — | `200 { status: "ok", version }` |
| POST | `/api/auth/request` | — | body `{siteId, email}` → always `202 {ok:true}`; `400 invalid_request` if malformed |
| POST | `/api/auth/exchange` | — | body `{siteId, token}` → `200 {sessionToken, expiresAt, siteId, email, role}`; `401 invalid_token`; `429 rate_limited`; `400` |
| GET | `/api/auth/me?site=<id>` | Bearer | `200 {siteId, email, role}`; `401 unauthorized`; `403 wrong_site`; `400` |
| POST | `/api/auth/logout` | Bearer | `204` |
| any | anything else | — | `404 { error: "not_found" }` |
Unhandled errors → `500 internal_error`; only the error name is logged.

## Login flow (ADR-008, ADR-010)
1. `request`: answers 202 immediately; in the background (`waitUntil`) it counts rate limits, checks
   `sites` + `site_users`, stores `sha256(token)` in `login_tokens` (15 min) and mails
   `<site.origin>/uredi#login=<token>`. Unknown site/address, other site's user or exceeded limits → no mail,
   same response.
2. `exchange`: one atomic `UPDATE … WHERE used_at IS NULL AND expires_at > now AND site_id = ? RETURNING` makes
   the link single use; the user must still be in `site_users`; creates a session (30 days, stored hashed).
3. `me` / every future protected route: session joined with `site_users`, so removing a user revokes at once;
   the session's site must equal the requested site.

Tokens: 32 random bytes, base64url (43 chars). Never stored or logged in clear text.
Rate limits (fixed 1-hour windows in `rate_limits`, keys are SHA-256 of site+e-mail or IP): 5 login mails per
site+e-mail, 20 login requests per IP, 30 exchanges per IP. IP from `CF-Connecting-IP`.

## Data (D1, `migrations/0001_auth.sql`)
`sites(id, name, origin)`, `site_users(site_id, email, role owner|editor)`, `login_tokens`, `sessions`,
`rate_limits`. Times are integer ms. Adding a site/user: `docs/runbooks/add-site-user.md`.

## Env vars and secrets (Worker)
| Name | Where | Value |
|---|---|---|
| `GIT_SHA` | deploy (`--var`) | commit SHA |
| `DB` | D1 binding (wrangler.jsonc) | `inzenirji-editor-dev` |
| `MAIL_TRANSPORT` | wrangler.jsonc vars | `smtp` (local `.dev.vars`: `console`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `MAIL_FROM`, `MAIL_FROM_NAME` | wrangler.jsonc vars | `mail.datavallis.com`, `465`, `hello@inzenirji.si`, … |
| `SMTP_PASSWORD` | **Secret**, Cloudflare dashboard → Worker → Settings → Variables and Secrets | owner only |

`consoleMailer` prints login links, so `selectMailer` allows it only when the request host is `localhost`,
`127.0.0.1` or `[::1]`; otherwise auth is unavailable (503) rather than leaking links into logs.

## Local
`cp apps/api/.dev.vars.example apps/api/.dev.vars`, then `pnpm dev` (root): builds, applies migrations to the
local D1 and runs the real Worker on :8787 (`--local-upstream localhost:8787`, otherwise wrangler rewrites the
request host to the custom domain and the console guard refuses). Seed a site with
`npx wrangler d1 execute DB --env dev --local --command "INSERT …"` (see runbook).
