# Handoff — state as of 2026-10-13 23:30 (Europe/Ljubljana)

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
- Killing dev servers: never `pkill -f …`/`pgrep -f …` or `ps aux | grep` from the agent shell (the pattern matches
  the shell's own command line and kills it). Use `ps -eo pid,args | awk '/wrangler|workerd/ && !/awk/ {print $1}'`
  in one command, then `kill <pids>` in the next.

## Bootstrap a fresh session
1. Clone, `git checkout dev && git pull`.
2. `corepack enable` (or use installed pnpm 10), `pnpm install --frozen-lockfile`.
3. `pnpm lint && pnpm typecheck && pnpm test` — must pass before starting a task.

## Repo / environments
- Repo: davidtacer/inzenirji-widget. Hosting: Cloudflare (ADR-009). dev: https://uredi-dev.inzenirji.si — Live.
- The agent's cloud session cannot reach `uredi-dev.inzenirji.si` (session egress proxy answers 403). Proof of a
  deploy is the green "Deploy dev" run (its smoke step checks the exact SHA) plus the owner's check.

## Done
- 2026-10-13: repo bootstrapped (initial commit on `main`, `dev` created from it). Default branch `dev` (owner).
- 2026-10-13: owner merged PR #1 (merge commit a05850e); set Cloudflare secrets for Actions.
- 2026-10-13: owner set Worker secret `SMTP_PASSWORD`, created D1 `inzenirji-editor-dev`
  (0cbe9b52-ff01-40d8-a348-cb54b05def54); PR #3 merged.
- 2026-10-13: TASK-004a (auth API) merged (PR #4, 2bb978c). Proof in `docs/tasks/TASK-004a.feedback.md`.
- 2026-10-13: TASK-004b (login UI) merged (PR #5); `/uredi` boilerplate docs (PR #6, ADR-011).
  **Auth Live on dev** — owner tested login + logout with a real e-mail (23:24).
- 2026-10-13: TASK-002 merged (PR #2, 6c28f06). First Deploy dev run failed: `CLOUDFLARE_API_TOKEN` empty
  (owner had entered the secrets wrongly). Owner fixed the secrets and re-ran Deploy dev → green; owner confirmed
  https://uredi-dev.inzenirji.si/api/health works (22:38). **Live on dev.** PR #3 adds a clear secret pre-check.
- 2026-10-13: PR #1 `feat/TASK-001-scaffold` → `dev` (includes the docs foundation commit): monorepo, embed,
  widget shell, API health, CI. CI green (run 38457710002, ~20 s). Proof in `docs/tasks/TASK-001.feedback.md`.
  Branch `docs/foundation` is contained in PR #1 and can be deleted.

## Owner's open actions
0. Done 2026-10-13: owner tested login/logout on dev via https://inzenirji.si/uredi (site `demo-site`).
1. Delete branch `docs/foundation` (contained in PR #1).
3. **Branch protection on `dev` and `main`** (recommended): require the `CI` check to pass before merge.
4. Optional: decide whether the repo should be private (it holds no secrets, but it is product code).

## Template requirements
- `/uredi` page boilerplate for client sites: `docs/template/uredi-page.md` (ADR-011). Move to the template repo when it exists.

## Parked ideas
- npm wrapper package around the embed script (ADR-002) if a non-template site ever needs it.

## Next
TASK-005 (GitHub content adapter: GitHub App, read/write `content/` on `dev`, merge, revert) — needs a
GitHub App from the owner and a test client repo; or the site template (phase 0) first. Latest TASK: 010 (004 split a/b) · latest ADR: 011.

## Open items
- Conversation retention proposed 12 months (owner to confirm); site "notes" + recent-change summary go into TASK-006.
- ADR-007 (schema location) to be decided with phase 0 (site template).
- Public price range vs. estimated cost for new pages/translations (product spec, open questions).
