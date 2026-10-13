# TASK-002 feedback
Status: PARTIAL — built and proven locally; the first real deploy runs after this PR is merged into `dev`
(the deploy workflow only runs from `dev`). Result is recorded in HANDOFF afterwards.

## What I implemented
Worker entry, `wrangler.jsonc` (env `dev` only, custom domain, no workers.dev/preview URLs), deploy workflow
gated on green CI for pushes to `dev`, smoke test, Worker dry-run bundle in CI.

## Files changed (path — why)
- `apps/api/src/worker.ts`, `apps/api/src/worker.test.ts` — Worker entry + test.
- `apps/api/wrangler.jsonc`, `apps/api/package.json` — Worker config, wrangler, scripts `deploy:dev`, `worker:dry-run`.
- `.github/workflows/deploy-dev.yml` — deploy to dev; `.github/workflows/ci.yml` — dry-run step.
- `pnpm-workspace.yaml` — allow `workerd` install script (wrangler's local runtime).
- `.gitignore` — `dist-worker/`.
- `docs/03-DECISIONS.md` — ADR-009 (commit from PR #1 that landed after the merge).
- Docs: `docs/technical/deploy.md`, `docs/technical/README.md`, `docs/CHEATSHEET.md`, `docs/HANDOFF.md`, task files.

## Deviations
None from the spec. The deploy cannot be proven before merge because `workflow_run` only fires on the default branch.

## New dependencies
wrangler@4.150.0 (dev) — Cloudflare deploy and local Worker runtime.

## Test results (real outputs, 2026-10-13 ~22:23 +02:00)
```
Checked 39 files. No fixes applied.        typecheck: Done ×4
shared 33 passed · api 12 passed · embed 13 passed · widget 18 passed
embed 969 B gzipped (budget 3072) OK
wrangler dry run: Read 5 files from the assets directory · Total Upload: 58.87 KiB / gzip: 14.82 KiB
```
Local Worker (`wrangler dev --env dev --var GIT_SHA:local-worker`, workerd):
```
/api/health  200 application/json  {"status":"ok","version":"local-worker"}
/api/nope    404 application/json  {"error":"not_found"}
/            200 text/html
/embed.js    200 text/javascript
/?site=hisa-denk&origin=…  200 text/html
```
Cross-origin browser test (client page on :8800, editor Worker on :8799, Chromium 390×844):
```
iframe src: http://localhost:8799/?site=hisa-denk&origin=http%3A%2F%2Flocalhost%3A8800
h1: Urejevalnik | site: hisa-denk
after close: http://localhost:8800/index.html
console errors: []
```

## NOT RUN
- Real deploy to Cloudflare and smoke on https://uredi-dev.inzenirji.si — runs after merge (see HANDOFF).
- Verifying the GitHub secrets exist — the session proxy blocks the Actions secrets API; the deploy run proves it.

## Open questions / risks
- First custom-domain deploy may wait a few minutes for the certificate; the smoke test retries for 5 minutes.
