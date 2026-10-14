# TASK-012 — feedback

## Proof (2026-10-14)
- `pnpm lint && pnpm typecheck && pnpm test` green: 325 tests (api 135, widget 77, shared 50, site-schema 42,
  embed 21); `pnpm build` and embed size (1164 B gz) OK.
- New tests: status reports both sites' commit + build (incl. queued / in progress / cancelled mapping);
  edit returns `commitSha`; widget: preparing → done with link and elapsed time, polling stops when done; stale
  status for the previous commit does not say done; failure / unknown texts; slow mark after 5 min; two edits
  resolve together; discard; publish → done on the live site.
- Deliberate break: removing the commit check in `applyStatus` → 2 tests fail; restored → green.
- Found by the tests while building: crash when no change was waiting (empty list) — fixed.

## Not verified here
- Real timing on demo-dev (the session cannot reach the demo domains); owner checks after merge.
