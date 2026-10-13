# TASK-004b feedback
Status: DONE — Live on dev. Owner tested on 2026-10-13 23:24 at https://inzenirji.si/uredi: login link
arrived by e-mail (real SMTP via mail.datavallis.com), login and logout work.

## What I implemented
- Protocol: `embed:login {v, type, token}` (embed → widget), `parseEmbedToWidget`, `loginTokenFromHash`.
- Embed: takes `#login=<token>` on load and on `hashchange`, removes it from the address bar immediately,
  posts it to the iframe once, only after `widget:ready`, only to the editor origin.
- Widget: login form (neutral confirmation), exchange of the e-mail token, session in partitioned iframe
  localStorage, session check on open, logout, error messages (invalid link, rate limit, network),
  latest-operation guard, fallback to a still-valid session when an old link is re-opened.

## Files changed (path — why)
- `packages/shared/src/embed-protocol.ts`, `shared.test.ts` — protocol + tests.
- `packages/embed/src/embed.ts`, `embed.test.ts` — token handoff + tests.
- `apps/widget/src/App.tsx`, `api.ts`, `session-store.ts`, `i18n.ts`, `styles.css` — login UI.
- `apps/widget/src/auth-ui.test.tsx`, `api-store.test.ts` — tests.
- Docs: `technical/{embed,widget,README}.md`, `02-ARCHITECTURE.md`, `tasks/README.md`, `HANDOFF.md`.

## Deviations
1. Added `hashchange` handling (not in the spec): a link pasted into a tab that already shows /uredi only
   changes the hash, and the first browser run showed the login silently not happening.
2. Re-opening an already used link while still signed in keeps the user signed in (no error), found in the
   browser run.
3. Widget bundle grew from 6.5 to 33.6 KB gzipped because API responses are validated with zod.

## Bugs found by the real-browser run and fixed
- Endless `GET /api/auth/me` loop after login: default dependencies were re-created on every render, re-running
  the auth effect. Fixed (created once with `useState`), regression test "default dependencies … exactly once".
- Login notice not shown when the response arrives fast enough that the form never unmounts: fixed with an
  effect syncing the notice (found by the unit test).

## Test results (2026-10-13 ~23:17 +02:00)
```
lint: Checked 51 files. No fixes applied.   typecheck: Done ×4
shared 50 passed · embed 21 passed · api 57 passed · widget 49 passed
embed 1164 B gzipped (budget 3072) OK · Worker dry run OK
```

## Deliberate breaks
1. Widget accepts login message from any origin → `FAIL … is ignored from a wrong origin` · 1 failed | 45 passed. Restored → 46 passed.
2. Latest-operation guard removed → `FAIL … wins over a slower stored-session check` · 1 failed | 47 passed (re-run after refactor). Restored → 48 passed.
3. Embed sends the token more than once → `FAIL … sends the token to the widget once …` · 1 failed | 19 passed. Restored → 20 passed.
4. Dependencies re-created per render → the test run crashes (`Worker exited unexpectedly with signal SIGKILL … auth-ui.test.tsx`, endless loop). Restored → 49 passed.

## Real browser, cross-origin (Chromium 390×844; client page on :8800, Worker + local D1 on :8787, console mail)
```
1 after request: Preverite e-pošto
2 link from mail: http://localhost:8800/uredi#login=<token>
3 after link: Prijavljeni kot test@example.com | url: http://localhost:8800/uredi
4 after reload: Prijavljeni kot test@example.com
5 old link again while signed in: Prijavljeni kot test@example.com | alerts: 0
6 after logout: form visible
7 old link after logout: Povezava ni več veljavna ali je bila že uporabljena. Zahtevajte novo.
8 after reload: still signed out
console errors: []
API calls: request 202 ×1 · exchange 200 ×1 · me 200 ×1 · exchange 401 ×1 · me 200 ×1 · logout 204 ×1 · exchange 401 ×1
```
Screenshots (form, signed in, invalid link) checked visually.

## NOT RUN
- Login on https://uredi-dev.inzenirji.si with a real e-mail — after merge; the agent's session cannot reach the dev URL.
- Safari (third-party iframe storage partitioning / ITP): only Chromium was tested. If Safari drops iframe
  storage, the user is simply asked to log in again.

## Open questions / risks
- Widget size (zod) — see technical/widget.md.
