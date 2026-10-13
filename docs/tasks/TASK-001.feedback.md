# TASK-001 feedback
Status: PARTIAL — code, local proof, docs and CI green; merge into `dev` pending (the agent's session may not
merge PRs, see HANDOFF "Owner's open actions"). PR: https://github.com/davidtacer/inzenirji-widget/pull/1

## What I implemented
- pnpm monorepo with `apps/widget`, `apps/api`, `packages/embed`, `packages/shared`; Biome, TS strict, Vitest.
- Shared: site id validation, embed protocol v1 (dependency-free parser), `HealthResponse`/`ErrorResponse` (zod).
- Embed: validated mount of one full-viewport iframe, idempotent, strict source + origin + schema check on messages.
- API: Hono app, `GET /api/health` with `GIT_SHA` version, JSON 404 and 500, Node entry.
- Widget: Preact shell (header, site id, close), sl/en i18n, origin-safe postMessage, dark-mode tokens,
  local demo client page; build copies `embed.js` into the widget output.
- CI workflow (single job `CI`).

## Files changed (path — why)
- root: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `biome.json`, `.nvmrc`,
  `.editorconfig` — workspace and tooling.
- `packages/shared/src/*` — shared contracts + tests.
- `packages/embed/*` — embed script, size check, tests.
- `apps/api/*` — API skeleton + tests.
- `apps/widget/*` — widget shell, demo page, tests.
- `.github/workflows/ci.yml` — CI.
- `docs/technical/*`, `docs/tasks/*`, `docs/HANDOFF.md` — documentation.

## Deviations from the task (and why)
1. Embed messages are validated by a hand-written parser, not zod: zod would exceed the 3 KB embed budget
   (ADR-002). Zod is still used for API contracts. Strictness is equal (exact keys, literal version, known types).
2. TypeScript **7.0.2** (current release) instead of 5.x; `tsc` works unchanged.
3. `@types/node` added (needed by Vite config, size script, Node entry).
4. `apps/api` has no build step yet; it runs with `tsx`. A bundle is added with the deploy task once ADR-006 is decided.
5. The local demo page and the editor share one origin (localhost:5173); cross-origin behaviour is covered by unit tests.

## New dependencies (package@version — why)
typescript@7.0.2, @biomejs/biome@2.5.15, vitest@5.0.4, happy-dom@21.0.1, @types/node@22 (tooling);
zod@4.6.7 (contracts); hono@4.13.13, @hono/node-server@2.1.5, tsx@4.23.15 (API); preact@11.0.1, vite@8.3.4,
@preact/preset-vite@2.10.6 (widget/embed build). All listed as allowed in the task except @types/node.

## How to verify (command — expected result)
- `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm size` — all pass.
- `pnpm dev`, open http://localhost:5173/demo/uredi.html — editor shows "Urejevalnik / demo-site";
  "Zapri" returns to the previous page.

## Test results (real outputs, 2026-10-13 ~21:46 +02:00, clean `node_modules`)
```
Checked 36 files in 29ms. No fixes applied.            (lint)
typecheck: Done ×4
packages/shared  Tests  33 passed (33)
apps/api         Tests  10 passed (10)
packages/embed   Tests  13 passed (13)
apps/widget      Tests  18 passed (18)
packages/embed build: ✓ built in 25ms
apps/widget build: ✓ built in 59ms
dist/embed.js: 1801 B raw, 969 B gzipped (budget 3072 B)
OK
```
Lint rules are active (probe file with `debugger;` → `lint/suspicious/noDebugger … Found 1 error.`).

Browser smoke (Playwright Chromium, API + Vite dev running, `GIT_SHA=local-smoke`):
```
{"status":"ok","version":"local-smoke"}                 curl :8787/api/health
{"status":"ok","version":"local-smoke"}                 curl :5173/api/health (proxy)
200 text/javascript; charset=utf-8                      curl :5173/embed.js
desktop iframes: 1 | h1: Urejevalnik | site: demo-site | after close url: http://localhost:5173/ | console errors: []
mobile  iframes: 1 | h1: Urejevalnik | site: demo-site | after close url: http://localhost:5173/ | console errors: []
```

CI on GitHub, PR #1, commit b8fbf36: job `CI` → **success**, 2026-10-13T19:48:05Z → 19:48:25Z (20 s),
https://github.com/davidtacer/inzenirji-widget/actions/runs/38457710002/job/115504591491

## Deliberate breaks
1. Site id pattern changed to allow uppercase →
   `FAIL src/shared.test.ts > isValidSiteId > "Abc" → false` · `Tests 1 failed | 32 passed (33)`.
   Restored → `Tests 33 passed (33)`.
2. Embed origin check removed (`event.origin !== editorOrigin` dropped) →
   `FAIL src/embed.test.ts > mount > close message > ignores a close message from another origin` ·
   `Tests 1 failed | 12 passed (13)`. Restored → `Tests 13 passed (13)`.

## NOT RUN
- Deploy / smoke on dev — NOT RUN: no environment (ADR-006 open).

## Docs updated
`docs/technical/{README,embed,widget,api,tooling}.md`, `docs/tasks/README.md`, `docs/HANDOFF.md`.

## Open questions / risks
- happy-dom prints one expected "Iframe page loading is disabled" line per mounted iframe in embed tests.
- Brand tokens for the widget (colours, fonts) still placeholders; needs Inženirji.si brand values.

## Suggested commit message
`feat: monorepo scaffold with embed, widget, API skeleton and CI (TASK-001)`
