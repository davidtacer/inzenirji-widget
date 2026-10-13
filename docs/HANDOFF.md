# Handoff — state as of 2026-10-13 21:50 (Europe/Ljubljana)

## Working mode
Mode B (autonomous), standing permission 2026-10-13 — owner's words: "B – avtonomno" (agent commits on
`feat/*`, `fix/*`, `docs/*`, opens PR to `dev`, merges only when every CI check is green).
Ask the owner only for: secrets, accounts, hosting/DNS, GitHub settings, product decisions, prod, irreversible steps.
Conversation with the owner in Slovenian; code and docs in English.

## Git and CI specifics
- Remote over HTTPS through the session proxy. `gh` GraphQL is blocked in cloud sessions: use REST
  (`gh api repos/davidtacer/inzenirji-widget/...`) for PRs, checks and merges.
- Create PR: `gh api repos/davidtacer/inzenirji-widget/pulls -f title=… -f head=<branch> -f base=dev -f body=…`
- Merge (squash): `gh api -X PUT repos/davidtacer/inzenirji-widget/pulls/<n>/merge -f merge_method=squash`
- Checks: `gh api repos/davidtacer/inzenirji-widget/commits/<sha>/check-runs`
- Repo is **public**: double-check every commit for secrets.
- **Merging is blocked for the agent in the 2026-10-13 session** (the session's permission layer denied
  "merge without review"; listing PRs was denied too). Until the owner changes that, the agent pushes branches
  and opens PRs, the owner merges. Do not try to work around it.
- Killing dev servers: never `pkill -f vite` / `pgrep -f node.ts` from the agent shell (matches the shell
  itself); find PIDs with `ps aux | grep "[n]ode.ts"` and `kill <pid>`.

## Bootstrap a fresh session
1. Clone, `git checkout dev && git pull`.
2. `corepack enable` (or use installed pnpm 10), `pnpm install --frozen-lockfile`.
3. `pnpm lint && pnpm typecheck && pnpm test` — must pass before starting a task.

## Repo / environments
- Repo: davidtacer/inzenirji-widget. No deployed environment yet (ADR-006 open).

## Done
- 2026-10-13: repo bootstrapped (initial commit on `main`, `dev` created from it).
- 2026-10-13: PR #1 `feat/TASK-001-scaffold` → `dev` (includes the docs foundation commit): monorepo, embed,
  widget shell, API health, CI. CI green (run 38457710002, ~20 s). Proof in `docs/tasks/TASK-001.feedback.md`.
  Branch `docs/foundation` is contained in PR #1 and can be deleted.

## Owner's open actions
0. **Merge PR #1 into `dev`** (squash) when its `CI` check is green:
   https://github.com/davidtacer/inzenirji-widget/pull/1 — then delete branch `docs/foundation`.
1. **Set default branch to `dev`**: https://github.com/davidtacer/inzenirji-widget/settings → General →
   Default branch → `dev`.
2. **Hosting decision (ADR-006)**: Cloudflare or Hetzner — blocks TASK-002 (dev deploy) and TASK-008.
3. **Branch protection on `dev` and `main`** (recommended): require the `CI` check to pass before merge.
4. Optional: decide whether the repo should be private (it holds no secrets, but it is product code).

## Parked ideas
- npm wrapper package around the embed script (ADR-002) if a non-template site ever needs it.

## Next
After TASK-001 is merged: TASK-003 (embed ↔ widget protocol hardening) and TASK-005 (GitHub content adapter)
can start; TASK-002 waits for ADR-006. Latest TASK: 010 · latest ADR: 008.

## Open items
- ADR-007 (schema location) to be decided with phase 0 (site template).
- Public price range vs. estimated cost for new pages/translations (product spec, open questions).
