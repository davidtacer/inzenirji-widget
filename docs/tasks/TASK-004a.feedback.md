# TASK-004a feedback
Status: DONE — Live on dev. Owner tested on 2026-10-13 23:24 at https://inzenirji.si/uredi: login link
arrived by e-mail (real SMTP via mail.datavallis.com), login and logout work.

## What I implemented
D1 schema, login request (background, no enumeration, rate limited), single-use link exchange, 30-day sessions,
`me`, logout, SMTP mailer (worker-mailer, TLS 465, no logging), console mailer guarded to localhost,
deploy applies migrations and smoke-tests that auth is wired. Node entry removed (ADR-010).

## Files changed (path — why)
- `apps/api/migrations/0001_auth.sql` — schema.
- `apps/api/src/auth/{service,routes}.ts`, `src/app.ts`, `src/worker.ts`, `src/mailer.ts`, `src/crypto.ts`, `src/db.ts` — auth.
- `apps/api/src/testing/sqlite-d1.ts`, `src/auth/auth.test.ts`, `src/worker.test.ts`, `vitest.config.ts` — tests.
- `apps/api/src/node.ts` — removed. `apps/api/package.json` — worker-mailer; removed @hono/node-server, tsx; scripts.
- `apps/api/wrangler.jsonc` — `nodejs_compat`, D1 binding, mail vars. `apps/api/.dev.vars.example`.
- `packages/shared/src/auth.ts`, `index.ts` — contracts.
- `.github/workflows/deploy-dev.yml` — migrations + auth smoke. Root `package.json` dev script, `.gitignore`.
- Docs: ADR-010, TASK-004 spec, `technical/{api,deploy,tooling,README}.md`, `runbooks/add-site-user.md`,
  `02-ARCHITECTURE.md`, `CHEATSHEET.md`, `HANDOFF.md`, `tasks/README.md`.

## Deviations
1. Task split into 004a (API) and 004b (UI) to keep PRs reviewable (~800-line guideline).
2. Login request does all work in the background (`waitUntil`), so the 202 cannot leak via timing.
3. Local dev needs `--local-upstream localhost:8787`: `wrangler dev` otherwise rewrites the request host to the
   custom domain and the console-mail guard (correctly) refuses.

## New dependencies
worker-mailer@1.2.1 (SMTP over Cloudflare TCP sockets, no dependencies). Removed @hono/node-server, tsx.

## Test results (2026-10-13 ~22:55 +02:00)
```
lint: Checked 47 files. No fixes applied.     typecheck: Done ×4
apps/api  Tests  57 passed (57)
```
Covered: mail content and link; e-mail normalisation; only hashes stored; unknown address/site/other site's user →
same 202 and no mail; per-e-mail limit at 5 and reset exactly at the 1-hour boundary; per-IP limit 20 (also for
unknown addresses); malformed bodies 400; exchange single use, expiry at TTL−1 ms vs TTL, other site, removed user,
unknown/malformed tokens, exchange limit 30 → 429; me own site / other site 403 / no header / unknown / malformed
headers; session expiry at 30 days; removal revokes; logout; failing mailer → 202 and log without address;
503 without auth deps; `selectMailer` config and localhost guard. Every test asserts that no log line contains `@`
or a 43-char token.

## Deliberate breaks
1. Single use removed (`AND used_at IS NULL`) → `FAIL … exchange > is single use` · `1 failed | 56 passed`. Restored → 57 passed.
2. Site check on `/me` removed → `FAIL … refuses the session on another site with 403` · `1 failed | 56 passed`. Restored → 57 passed.
3. Console mailer allowed everywhere → `FAIL … refuses the console transport on https://uredi-dev.inzenirji.si/api`
   and `… on https://localhost.evil.example/api` · `2 failed | 55 passed`. Restored → 57 passed.

## Real Worker + local D1 (wrangler 4.150.0, workerd)
```
migrations apply --local: 0001_auth.sql ✅ (8 commands)
1 request (registered)   {"ok":true} 202
2 request (unknown)      {"ok":true} 202
mails printed: 1, link: http://localhost:8800/uredi#login=<token>
3 exchange               {'sessionToken': '<43 chars>', 'expiresAt': 1794516988816, 'siteId': 'demo-site', 'email': 'test@example.com', 'role': 'owner'}
4 exchange again         {"error":"invalid_token"} 401
5 me                     {"siteId":"demo-site","email":"test@example.com","role":"owner"} 200
6 me other site          {"error":"wrong_site"} 403
7 logout                 204
8 me after logout        {"error":"unauthorized"} 401
db: [{'lt': 1, 'used': 1, 's': 0, 'hashlen': 64}]
```
(Request 1 used `Test@Example.com`; the stored/returned address is lowercase.)

## NOT RUN
- Remote migration and SMTP on dev — after merge (deploy smoke checks `POST /api/auth/request {}` → 400).
- Real e-mail delivery through `mail.datavallis.com` — needs a test user on dev; SPF note in HANDOFF.
- Concurrency of the single-use update under real parallel requests — relies on SQLite/D1 single-writer semantics.

## Open questions / risks
- SPF `v=spf1 +a +mx ~all` may not cover `mail.datavallis.com`; mails could land in spam.
- Expired `login_tokens`, `sessions` and `rate_limits` rows are not cleaned up yet (small; a cron cleanup later).
