# TASK-001 — Monorepo scaffold, tooling and CI
Depends on: —
Read first: docs/00-MANIFEST.md, docs/03-DECISIONS.md (ADR-001…005), docs/02-ARCHITECTURE.md

## Goal
A developer can clone the repo, run `pnpm install && pnpm dev` and see the empty editor running inside
an iframe on a local demo "client page"; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass
locally and in CI on every PR to `dev`.

## Scope
### 1. Workspace
- `pnpm-workspace.yaml` (`apps/*`, `packages/*`), root `package.json` with `lint`, `format`, `typecheck`,
  `test`, `build`, `dev` scripts; `packageManager` pinned; `engines.node >= 22`.
- `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), `biome.json`, `.nvmrc`, `.editorconfig`.

### 2. `packages/shared`
- `EMBED_PROTOCOL_VERSION = 1` and zod schemas for embed ↔ widget messages: `widget:ready`, `widget:close`.
- `isValidSiteId` (lowercase letters, digits, hyphens, 3–63 chars, no leading/trailing hyphen).
- `HealthResponse` schema.

### 3. `packages/embed`
- Reads `data-site` from its own `<script>` tag. Invalid/missing site id → no iframe, `console.error`.
- Creates one full-viewport iframe to `<editorOrigin>/?site=<id>&origin=<location.origin>`
  (`editorOrigin` = script's own origin, overridable by `data-editor-origin` for local dev).
- Idempotent: loading the script twice creates one iframe.
- Accepts `widget:close` only from `editorOrigin` and only schema-valid messages; on close → `history.back()` fallback to `/`.
- Built as a single IIFE; CI fails if gzipped size > 3 KB (ADR-002).

### 4. `apps/api`
- Hono app: `GET /api/health` → `{ status: "ok", version: <GIT_SHA env or "dev"> }`, validated by `HealthResponse`.
- Unknown `/api/*` → 404 JSON `{ error: "not_found" }`.
- Node entry (`src/node.ts`) with `@hono/node-server`; `PORT` env (default 8787).

### 5. `apps/widget`
- Preact app shell: header "Urejevalnik", site id from `?site=`; invalid/missing → error message.
- i18n module: all strings in `sl` (default) and `en`.
- On mount posts `widget:ready` to the parent, but only to the `origin` query param if it is a valid http(s) origin.
- Close button posts `widget:close`.
- `pnpm dev` serves widget, embed and a `demo/uredi.html` page that loads the embed (local end-to-end check).

### 6. CI (`.github/workflows/ci.yml`)
- On PR and push to `dev`/`main`: setup pnpm + Node 22, `pnpm install --frozen-lockfile`, lint, typecheck, test, build, embed size check.

## Decisions already made (do not re-decide)
ADR-001…005.

## Tests
- shared: valid/invalid messages, site id boundaries (2, 3, 63, 64 chars; leading/trailing hyphen; uppercase).
- embed: creates iframe with correct URL; missing/invalid site → no iframe; second load → still one iframe;
  close message from wrong origin ignored; malformed message ignored; valid close handled.
- api: health 200 with schema-valid body and version from env; unknown route 404.
- widget: i18n has same keys in `sl` and `en`; target-origin validation; renders error for invalid site.
- Deliberate break on: site id validation, embed origin check.

## Must not touch
Nothing else exists yet.

## Allowed dependencies
typescript, @biomejs/biome, vitest, happy-dom, zod, hono, @hono/node-server, tsx, preact, vite, @preact/preset-vite.
Anything else: justify in feedback.

## Acceptance criteria
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm --filter @inzenirji/embed size` pass locally (outputs pasted).
- CI green on the PR.
- Deliberate breaks shown.
- Technical docs + HANDOFF updated.
