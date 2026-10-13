# Handoff — state as of 2026-10-13 23:00 (Europe/Ljubljana)

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
- 2026-10-13: TASK-004a (auth API) on `feat/TASK-004a-auth-api` — PR open. Proof in `docs/tasks/TASK-004a.feedback.md`.
- 2026-10-13: TASK-002 merged (PR #2, 6c28f06). First Deploy dev run failed: `CLOUDFLARE_API_TOKEN` empty
  (owner had entered the secrets wrongly). Owner fixed the secrets and re-ran Deploy dev → green; owner confirmed
  https://uredi-dev.inzenirji.si/api/health works (22:38). **Live on dev.** PR #3 adds a clear secret pre-check.
- 2026-10-13: PR #1 `feat/TASK-001-scaffold` → `dev` (includes the docs foundation commit): monorepo, embed,
  widget shell, API health, CI. CI green (run 38457710002, ~20 s). Proof in `docs/tasks/TASK-001.feedback.md`.
  Branch `docs/foundation` is contained in PR #1 and can be deleted.

## Owner's open actions
0. Merge the TASK-004a PR when `CI` is green; check that "Deploy dev" is green (it now applies D1 migrations and
   smoke-tests auth wiring). If the migration step fails with an authorization error, the Cloudflare token lacks
   **Account → D1 → Edit**.
0b. Add yourself as a test user on dev (runbook `docs/runbooks/add-site-user.md`, site e.g. `demo-site` with
   origin of the test page) — needed to try login once TASK-004b ships.
0c. SPF for `inzenirji.si` is `v=spf1 +a +mx ~all`: login mails only pass SPF if `mail.datavallis.com` sends from an
   IP of the `inzenirji.si` MX/A records. Safer: `v=spf1 +a +mx a:mail.datavallis.com ~all`. Check DKIM too.
1. Delete branch `docs/foundation` (contained in PR #1).
3. **Branch protection on `dev` and `main`** (recommended): require the `CI` check to pass before merge.
4. Optional: decide whether the repo should be private (it holds no secrets, but it is product code).

## Parked ideas
- npm wrapper package around the embed script (ADR-002) if a non-template site ever needs it.

## Next
TASK-004b (embed passes `#login` token, widget login form, session in iframe storage), then TASK-005
(GitHub content adapter). Latest TASK: 010 (004 split a/b) · latest ADR: 010.

## Open items
- Conversation retention proposed 12 months (owner to confirm); site "notes" + recent-change summary go into TASK-006.
- ADR-007 (schema location) to be decided with phase 0 (site template).
- Public price range vs. estimated cost for new pages/translations (product spec, open questions).
