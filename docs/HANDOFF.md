# Handoff — state as of 2026-10-14 10:00 (Europe/Ljubljana)

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
- 2026-10-14: owner merged #12 + #13 and tested (deploy progress + per-site schema work live). TASK-014 GitHub App
  built (PR open); owner creates the app per `docs/runbooks/github-app.md`.
- 2026-10-14: owner tested publish + undo on the demo too (main: e8f5026 publish, f7edae4 undo).
  ADR-013 (owner): every site defines its own blocks; the editor reads the site's `schema.json`. TASK-013 built
  (PR open, stacked on #12). `schema.json` already on `demo/main` + `demo/dev`. Contract for building new sites:
  `docs/guides/site-contract.md` — owner wants an export package with all instructions for another agent once the
  editor is finished: keep that guide complete and current.
- 2026-10-14 morning: owner merged #8–#11, set `GITHUB_TOKEN` + `ANTHROPIC_API_KEY`, seeded D1 → **full loop Live
  and owner-tested** (edit of the phone number via chat → demo-dev, cost 0,04 €). Owner feedback: the reply said
  "check the test site" before the build had finished → TASK-012 (PR open).
- 2026-10-13: repo bootstrapped (initial commit on `main`, `dev` created from it). Default branch `dev` (owner).
- 2026-10-13: owner merged PR #1 (merge commit a05850e); set Cloudflare secrets for Actions.
- 2026-10-13/14 night (owner asleep, ADR-012): PR #8 site template + demo site (branches `demo/dev`, `demo/main`
  created by the agent; demo-dev.inzenirji.si and demo.inzenirji.si deployed, smoke green), PR #9 GitHub store,
  PR #10 agent, PR #11 chat UI — all CI green, not merged (agent cannot merge).
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
### Morning 2026-10-14 — done (kept for reference when onboarding the next site)
1. **Merge in this order**, each when `CI` is green (they are stacked):
   #8 site template → #9 GitHub store → #10 agent → #11 chat UI. After each merge "Deploy dev" runs (it applies
   D1 migration `0002_content.sql`).
2. **GitHub token** (fine-grained): https://github.com/settings/personal-access-tokens/new → Resource owner
   `davidtacer` → Only select repositories: `inzenirji-widget` → Repository permissions: **Contents: Read and
   write** (Metadata: Read-only is added automatically) → Generate. Keep your own copy. Fine-grained tokens
   have no "Checks" permission; the repo is public, so check runs are readable without it.
3. **Worker secrets** (Cloudflare → Workers & Pages → `inzenirji-editor-dev` → Settings → Variables and Secrets,
   type Secret): `GITHUB_TOKEN` = token from step 2; `ANTHROPIC_API_KEY` = Anthropic API key.
4. **D1 console** (`inzenirji-editor-dev`), with your e-mail:
   ```sql
   INSERT INTO sites (id, name, origin, created_at)
   VALUES ('demo', 'Gostilna Pri Lipi (demo)', 'https://demo.inzenirji.si', unixepoch() * 1000);
   INSERT INTO site_users (site_id, email, role, created_at)
   VALUES ('demo', 'TVOJ@NASLOV', 'owner', unixepoch() * 1000);
   INSERT INTO site_repos (site_id, owner, repo, dev_branch, main_branch, content_root, preview_url, live_url)
   VALUES ('demo', 'davidtacer', 'inzenirji-widget', 'demo/dev', 'demo/main', 'apps/site/content',
           'https://demo-dev.inzenirji.si', 'https://demo.inzenirji.si');
   ```
5. Open https://demo.inzenirji.si/uredi → log in → write e.g. "Bučna juha naj stane 6,50 €" → wait for
   "Testna stran · pripravljena" (1–2 min) → check https://demo-dev.inzenirji.si/meni → "Objavi v živo" →
   https://demo.inzenirji.si/meni after 1–2 min → try "Razveljavi zadnjo objavo".
   If an edit fails with a Cloudflare CPU-limit error (1102), switch the account to Workers Paid (ADR-009).

### GitHub App (TASK-014) — after merging its PR
Follow `docs/runbooks/github-app.md`: create the app, install it on `inzenirji-widget`, set Worker secrets
`GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`, test an edit on the demo, then delete `GITHUB_TOKEN` and revoke it.

### Still open
- Delete branch `docs/foundation` (contained in PR #1).
- **Branch protection on `dev` and `main`** (recommended): require the `CI` check to pass before merge.
- Optional: make the repo private — commit messages of demo edits contain the request text (demo content is fictional).
- SPF for `inzenirji.si`: consider `v=spf1 +a +mx a:mail.datavallis.com ~all`; check DKIM.
- Confirm conversation retention (proposed 12 months).

## Parked ideas
- npm wrapper package around the embed script (ADR-002) if a non-template site ever needs it.

## Next
After the morning test: TASK-008 screenshots of the test site in the chat (Browser Rendering), measure real
cost per edit (phase 1), template blocks the owner wants, real client onboarding (own repo per client,
GitHub App, Workers Paid). Owner asked about using the editor on existing sites
(inzenirji.si): proposed hybrid — the site reads selected texts/prices from JSON content, design stays in its code
(pixel-identical, check with before/after screenshots). Next: TASK-014 GitHub App (owner agreed 2026-10-14). Later: reference
blocks + image upload from the chat, multilingual sites (content per language). Latest TASK: 014 (planned) ·
latest ADR: 013.

## Open items
- Conversation retention proposed 12 months (owner to confirm); site "notes" + recent-change summary go into TASK-006.
- ADR-007 (schema location) to be decided with phase 0 (site template).
- Public price range vs. estimated cost for new pages/translations (product spec, open questions).
