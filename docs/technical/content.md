# Content on GitHub, publish, undo — `apps/api/src/content`, `apps/api/src/sites`

Status: **Built** (TASK-005). Needs the Worker secret `GITHUB_TOKEN` and a `site_repos` row per site.

## Model (ADR-012)
Each site's content lives in a GitHub repo under `content_root` (`site.json`, `pages/<slug>.json`):
- `dev_branch` = hidden test site (every editor change is one commit here),
- `main_branch` = live site (changes arrive only by **publish**).
The site template builds and deploys each branch (demo: `.github/workflows/site-demo.yml`).

## Store (`content/github.ts`)
| Method | GitHub calls | Notes |
|---|---|---|
| `read(branch)` | ref → contents of `site.json`, list + contents of `pages/` | pinned to the head SHA it read |
| `commit(changes, msg, expectedHead)` | ref, commit, `POST git/trees` (inline content / `sha:null` delete), `POST git/commits`, `PATCH ref force:false` | only `site.json` and `pages/<slug>.json` (`isAllowedContentPath`); refuses if the branch moved since `read` |
| `publish(msg)` | compare (content files only) → `POST merges` dev→main | no-op when no content file differs; commit message starts with `Objava urejevalnika: ` |
| `undoLastPublish()` | head commit must start with the publish prefix → new commit on main with the parent's tree → merge main→dev | never reverts template/code commits or an undo |
| `discardDraft()` | `PATCH dev ref` to main head (force) | drops unpublished changes |
| `status()` | refs, compare, check-runs "Deploy site" on dev and main heads | `unpublished` = changed content files; `previewBuild`/`liveBuild` pending (also: no run yet)/success/failure (incl. cancelled)/unknown (API not readable). The job ends after deploy + smoke test, so success = the site serves that commit |
GitHub errors → `GitHubError` (`unauthorized`, `not_found`, `conflict`, `nothing_to_undo`, `upstream`).

## Routes (`sites/routes.ts`) — Bearer session of the same site required
| Method | Path | Response |
|---|---|---|
| GET | `/api/sites/:siteId/status` | `{unpublished, previewSha, previewBuild, liveSha, liveBuild, previewUrl, liveUrl}` |
| POST | `/api/sites/:siteId/publish` | `{published, sha, liveUrl}` (logged as `publish`) |
| POST | `/api/sites/:siteId/undo` | `{undone, sha, liveUrl}`; `409 nothing_to_undo` |
| POST | `/api/sites/:siteId/discard` | `{discarded}` |
Errors: 401 no/invalid session, 403 `wrong_site`, 404 `site_not_connected`, 503 `github_unavailable` (no token),
409 `conflict`, 502 `github_unavailable` (GitHub failed; only code + status are logged).

## Data (`migrations/0002_content.sql`)
`site_repos(site_id, owner, repo, dev_branch, main_branch, content_root, preview_url, live_url)`,
`change_log(site_id, email, kind edit|publish|undo|discard, request, reply, commit_sha, model, tokens…, cost_micros, price_cents, created_at)`.

## Tests
`content/github.test.ts` runs the store against `testing/fake-github.ts`, an in-memory git (trees, commits,
refs, three-way merge with conflicts, best common ancestor) behind the same REST endpoints.
