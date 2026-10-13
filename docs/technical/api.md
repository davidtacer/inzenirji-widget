# API — `apps/api`

Status: **Built** (health only; not deployed).

## Structure
- `src/app.ts` — `createApp(config)` builds a Hono app under `/api`. Runtime-agnostic (Web standard
  Request/Response) so it can run on Node or Cloudflare Workers (ADR-006 open).
- `src/node.ts` — Node entry (`@hono/node-server`), run with `tsx` (`pnpm --filter @inzenirji/api start`).
- `configFromEnv(env)` — all configuration comes from env vars at runtime.

## Routes
| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `200 { status: "ok", version }` (`HealthResponse` in shared) |
| any | anything else | `404 { error: "not_found" }` |
Unhandled errors → `500 { error: "internal_error" }`; details are logged (message only), never returned.

## Env vars
| Name | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Node listen port |
| `GIT_SHA` | `dev` | Deployed commit, returned by `/api/health` (smoke check after deploy) |

No secrets are used yet. Planned secret names are in `docs/CHEATSHEET.md`.
