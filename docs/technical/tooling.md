# Tooling and CI

Status: **Built**.

## Workspace
- pnpm 10 workspaces (`apps/*`, `packages/*`), `packageManager` pinned in root `package.json`, Node 22 (`.nvmrc`).
- Packages use TypeScript sources directly (`exports` point at `.ts`); bundlers (Vite) and `tsx` compile them.
  `allowImportingTsExtensions` + `noEmit` in `tsconfig.base.json`; each package type-checks itself.
- `onlyBuiltDependencies: [esbuild]` in `pnpm-workspace.yaml` (esbuild is used by `tsx`).

## Commands (root)
| Command | Does |
|---|---|
| `pnpm lint` | Biome check (recommended rules, formatting, import order) |
| `pnpm format` | Biome with `--write` |
| `pnpm typecheck` | `tsc` in every package (TypeScript 7) |
| `pnpm test` | Vitest in every package |
| `pnpm build` | embed, then widget (widget depends on embed) |
| `pnpm size` | gzipped embed budget check |
| `pnpm dev` | API + widget dev servers |

## CI (`.github/workflows/ci.yml`)
One job named `CI` on PRs and pushes to `dev`/`main`: install with frozen lockfile → lint → typecheck →
test → build → size. Use this job name for branch protection.
