# Editing agent (level 1) — `apps/api/src/agent`, `POST /api/sites/:siteId/edit`

Status: **Live** on dev (TASK-006, owner-tested 2026-10-14). Per-site schema: TASK-013 (ADR-013).
Needs Worker secrets `ANTHROPIC_API_KEY` and `GITHUB_TOKEN`.

## Flow of one message
1. `POST /api/sites/:siteId/edit {message}` — session of that site; 1–2000 chars; max 30 edits/hour per site.
   With images (TASK-015): `multipart/form-data` with `message` + up to 3 `images` (≤ 1.5 MB each, JPEG/PNG/WebP
   by magic bytes; `content/images.ts`). Errors: `400 too_many_images | image_too_large | image_type |
   uploads_not_supported` (site schema has no `uploads`). Images go to the model as image blocks with their future
   URL (`<publicPath>/<YYYY-MM-name-hash8>.<ext>`), cached after the first step; only images whose URL appears in
   the changed content are committed (same commit). Response adds `images` (URLs committed).
2. Read the test branch (`dev_branch`) at its head SHA: the site's own `schema.json` (ADR-013, parsed by
   `content/site-schema.ts`; missing/invalid → `503 site_schema_invalid`, reason logged), `site.json`, `pages/*.json`.
3. `runEdit` (`agent.ts`): Claude (Messages API, `EDIT_MODEL`, default `claude-sonnet-5-5`) gets the rules, the
   site's own `notes` and site/page JSON Schemas from its `schema.json` (the editor knows no block types), the page list, the last 5 edits of the site (request →
   reply) and the owner's message; system prompt and tools are prompt-cached.
4. Tools: `list_pages`, `read_page`, `read_site`, `write_page` (complete page JSON), `write_site`, `delete_page`
   (not `index`), `escalate`. Every write is validated against the site's schema with `@cfworker/json-schema`
   (no `eval`, Workers-safe; ~0.5 ms per page); errors are reduced to the block kind that was written
   (`issues()`) and go back to the model to fix. Page slugs: lowercase/digits/hyphens, not `uredi`. The model
   only ever changes an in-memory copy. Max 10 model calls; `max_tokens`/refusal/too many steps → no changes.
5. Changed files (key-order-independent comparison) become one commit on the test branch,
   message `Urejevalnik: <first line of the request>`; the store refuses if the branch moved meanwhile (409).
6. Every processed message is logged in `change_log` with tokens, cost (micro-euros) and price (cents),
   also when nothing changed or the commit conflicted.
7. Answer: `{reply, changed, files, escalated, previewUrl, costMicros, priceCents}`. The preview site rebuilds
   from the new commit (demo: ~1–2 min), see `GET /status` → `previewSha`/`previewBuild`; `POST /edit` returns `commitSha`, and the widget says "done" only
   when that commit is built (TASK-012). The agent is told not to claim the change is already visible.

## Cost (`pricing.ts`, ADR-005)
USD per million tokens (third-party sources, 2026-10-13 — verify before billing):
Sonnet 5.5 input 2, output 10, cache read 0.2, cache write (5 min) 2.5; Haiku 5.5 0.1 / 0.5 / 0.01 / 0.125
(×5 when a request's prompt exceeds 100k tokens). Cost = Σ requests × `USD_TO_EUR` (default 0.92), rounded up
to the micro-euro. Price = ⌈cost × `PRICE_MARGIN` / 10 000⌉ cents (margin default 1; no charging yet).

## Errors
`503 agent_unavailable` (no API key / unknown model), `502 agent_unavailable` (Anthropic API failed; only the
status is logged), `409 conflict`, `429 rate_limited`, `400 invalid_request`, plus the site access errors in content.md.

## Notes
- Commit messages contain the owner's request: client repos must be private (the demo repo is public — use only
  fictional content there).
- Workers Free allows 10 ms CPU per request; schema/JSON work per edit is small but if edits fail with a CPU
  limit error, switch the account to Workers Paid (ADR-009).
