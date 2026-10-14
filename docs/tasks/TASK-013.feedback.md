# TASK-013 — feedback

## Proof (2026-10-14)
- `pnpm lint && pnpm typecheck && pnpm test` green: 347 tests (api 156, widget 78, shared 50, site-schema 42,
  embed 21); `pnpm build`, embed size, Worker dry run OK (bundle 160 KB gz, no `eval`/`new Function`).
- `pnpm --filter @inzenirji/site schema:check` green; CI and the demo deploy workflow run it.
- Tests: a site with its own `timeline` block (nothing from the demo) is edited, a demo `menu` block is refused
  there, its prompt carries its notes and schema and no demo content; the demo schema validates the demo content;
  readable errors (only the written block kind); oversized/invalid schemas refused; missing schema → 503
  `site_schema_invalid`, no model call, nothing logged; `schema.json` can never be written by the editor.
- Validator speed: ~0.5 ms per page validation (demo menu page), compiled once per schema per isolate.
- Deliberate breaks: ignoring validation errors in `write_page` → 2 tests fail; removing the block-kind error
  filter → 1 test fails; restored → green.
- Demo branches: `schema.json` committed to `demo/main` (b0e9683) and merged into `demo/dev` (d7aa087) before
  this change is deployed, so demo editing keeps working.
- Found while building: the validator repeats the same schema location for every list item, so the error filter
  must also match the instance (block) — fixed and covered by the test.

## Notes
- Side effect: the last live commit on `demo/main` is now the schema commit, so "Razveljavi zadnjo objavo" has
  nothing to undo until the next publish (by design: undo never reverts developer commits).
