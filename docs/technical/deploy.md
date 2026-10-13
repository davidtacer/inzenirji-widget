# Deploy (Cloudflare)

Status: **Live** on dev since 2026-10-13. Production: Planned (owner decision).

## Shape
One Worker per environment serves everything on one origin:
- static assets from `apps/widget/dist` (`index.html`, hashed assets, `embed.js`);
- `/api/*` runs `apps/api/src/worker.ts` first (`run_worker_first`), which wraps `createApp`.
Config: `apps/api/wrangler.jsonc`. No workers.dev URL, no preview URLs.

| Env | Worker name | URL | How |
|---|---|---|---|
| dev | `inzenirji-editor-dev` | https://uredi-dev.inzenirji.si | automatic after green CI on `dev` |
| prod | — | https://uredi.inzenirji.si | Planned, owner only |

The custom domain's DNS record and certificate are created by Cloudflare on the first deploy
(`inzenirji.si` is on Cloudflare).

## Pipeline (`.github/workflows/deploy-dev.yml`)
CI green on a push to `dev` → checkout that SHA → install → build → check secrets →
`wrangler d1 migrations apply DB --env dev --remote` → `wrangler deploy --env dev --var GIT_SHA:<sha>`
→ smoke: `/api/health` must return exactly that SHA (retries 5 min), `/` and `/embed.js` 200, unknown API route 404,
`POST /api/auth/request {}` → 400 (proves DB and SMTP config are wired; 503 would mean they are not).
Migrations must stay backward compatible with the previously deployed Worker (expand → migrate → contract).
Can also be started manually (Actions → Deploy dev → Run workflow) on `dev`.

## Secrets
- GitHub Actions (repository): `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" + Account → D1 → Edit,
  zone `inzenirji.si`), `CLOUDFLARE_ACCOUNT_ID`.
- Worker (Cloudflare dashboard → `inzenirji-editor-dev` → Settings → Variables and Secrets): `SMTP_PASSWORD`.
  Worker secrets survive deploys.

## D1
Database `inzenirji-editor-dev` (id in `wrangler.jsonc`, binding `DB`), created by the owner 2026-10-13.

## Local
- `pnpm --filter @inzenirji/api worker:dry-run` — bundle check without credentials (also in CI).
- `cd apps/api && npx wrangler dev --env dev --port 8799` — real Worker runtime locally (after `pnpm build`).

## Rollback
Cloudflare dashboard → Workers & Pages → `inzenirji-editor-dev` → Deployments → pick previous → Rollback,
or `npx wrangler rollback --env dev` with the owner's credentials. Not yet practised.
