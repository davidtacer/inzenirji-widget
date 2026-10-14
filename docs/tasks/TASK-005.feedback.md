# TASK-005 feedback
Status: PARTIAL — built and unit-proven against an in-memory git; live run needs the owner's `GITHUB_TOKEN`
Worker secret and the `site_repos` row (HANDOFF morning steps).

## What I implemented
GitHub content store (read, one-commit write limited to content files, publish, undo of the last publish,
discard, status), `/api/sites/:siteId/{status,publish,undo,discard}` with site-bound sessions, D1 migration
`0002_content.sql` (`site_repos`, `change_log`), fake GitHub for tests.

## Deviations
- Fine-grained token instead of a GitHub App for dev (ADR-012).
- Publish/undo/discard sit under `/api/sites/:siteId/*` (the spec had no paths yet).

## Bugs found by tests and fixed
- After an undo, "publish" would have created an empty publish commit (dev only had a merge commit) → publish now
  checks changed content files first.
- Undo could have reverted a template/code commit → undo only reverts commits with the publish prefix.

## Test results (2026-10-13 ~23:55 +02:00)
```
apps/api  Tests  95 passed (95)   (store 27, site routes 12, auth 45, rest 11)
```

## Deliberate breaks
1. Path lock removed (`isAllowedContentPath` accepts anything) → path tests and "refuses to write outside the content files" fail. Restored → 38 passed.
2. Undo without the publish-prefix guard → "undo refuses when the last live commit is not a publish" fails. Restored → 38 passed.

## NOT RUN
- Real GitHub API calls (token not available to the agent; session has no Worker secrets).
