# TASK-002 — Deploy skeleton to dev (Cloudflare)
Depends on: TASK-001
Read first: docs/03-DECISIONS.md (ADR-002, ADR-009), docs/02-ARCHITECTURE.md, docs/technical/api.md

## Goal
Every green push to `dev` is live at https://uredi-dev.inzenirji.si: widget at `/`, embed at `/embed.js`,
API at `/api/*`, and `/api/health` reports the deployed commit.

## Scope
- `apps/api/src/worker.ts`: Worker entry around `createApp`, `GIT_SHA` var.
- `apps/api/wrangler.jsonc`: one Worker with static assets from `apps/widget/dist`, `run_worker_first: ["/api/*"]`,
  env `dev` named `inzenirji-editor-dev` on custom domain `uredi-dev.inzenirji.si`; no workers.dev, no preview URLs;
  no production environment.
- `.github/workflows/deploy-dev.yml`: runs after green `CI` on push to `dev` (or manual on `dev`); build,
  `wrangler deploy --env dev --var GIT_SHA:<sha>`, smoke test (health with exact SHA, index 200, embed 200, API 404).
- CI: Worker bundle dry run (no credentials).

## Decisions already made
ADR-009. Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` set by the owner in GitHub Actions (2026-10-13).

## Tests
- Unit: Worker entry returns health with `GIT_SHA` and falls back to `dev`.
- Local: `wrangler dev --env dev` serves `/`, `/embed.js`, `/api/health`, `/api/nope` (404).
- Browser: client page on another origin loads embed from the Worker; editor renders; close returns.

## Allowed dependencies
wrangler (dev dependency of apps/api).

## Acceptance criteria
- Deploy run green; smoke step shows the merge SHA from `https://uredi-dev.inzenirji.si/api/health`.
