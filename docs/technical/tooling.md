# Tooling and CI

Status: **Built**.

## Workspace
- pnpm 10 workspaces (`apps/*`, `packages/*`), `packageManager` pinned in root `package.json`, Node 22 (`.nvmrc`).
- Packages use TypeScript sources directly (`exports` point at `.ts`); bundlers (Vite, wrangler) compile them.
  `allowImportingTsExtensions` + `noEmit` in `tsconfig.base.json`; each package type-checks itself.
- `onlyBuiltDependencies: [esbuild, workerd]` in `pnpm-workspace.yaml` (install scripts of wrangler's toolchain).

## Commands (root)
| Command | Does |
|---|---|
| `pnpm lint` | Biome check (recommended rules, formatting, import order) |
| `pnpm format` | Biome with `--write` |
| `pnpm typecheck` | `tsc` in every package (TypeScript 7) |
| `pnpm test` | Vitest in every package |
| `pnpm build` | embed, then widget (widget depends on embed) |
| `pnpm size` | gzipped embed budget check |
| `pnpm dev` | build, then local Worker (wrangler, local D1, :8787) + widget dev server (:5173) |

## CI (`.github/workflows/ci.yml`)
One job named `CI` on PRs and pushes to `dev`/`main`: install with frozen lockfile → lint → typecheck →
test → build → size → Worker bundle dry run. Use this job name for branch protection.
