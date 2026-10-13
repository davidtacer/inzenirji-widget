# Technical docs — maintenance map

| Doc | Covers code | Status |
|---|---|---|
| `embed.md` | `packages/embed`, `packages/shared/src/embed-protocol.ts`, `site-id.ts` | Live (dev) |
| `widget.md` | `apps/widget` | Live (dev) |
| `api.md` | `apps/api` (incl. auth, migrations), `packages/shared/src/api.ts`, `auth.ts` | Live (dev) |
| `tooling.md` | root config, `.github/workflows/ci.yml` | Built |
| `site.md` | `apps/site`, `packages/site-schema`, `.github/workflows/site-demo.yml` | Built |
| `content.md` | `apps/api/src/content`, `apps/api/src/sites`, `migrations/0002_content.sql` | Built |
| `agent.md` | `apps/api/src/agent`, edit route in `apps/api/src/sites/routes.ts` | Built |
| `deploy.md` | `apps/api/wrangler.jsonc`, `apps/api/src/worker.ts`, `.github/workflows/deploy-dev.yml` | Live (dev) |
