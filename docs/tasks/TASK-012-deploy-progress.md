# TASK-012 — Chat shows deploy progress; "done" only when the site serves the change

## Why
Owner test 2026-10-14: the editor replied "changed, check the test site", the owner opened the test site and the
change was not there yet (build + deploy take 1–2 minutes). The chat must show that the change is on its way
and say "done" only when the site actually serves it.

## Scope
- API: `GET /status` adds `previewSha`, `liveSha`, `liveBuild`; `POST /edit` returns `commitSha`;
  publish/undo return `sha`. Build state = check run "Deploy site" of that commit (ends after deploy + smoke).
- Widget: editor reply with a change shows spinner + "Pripravljam testno stran … m:ss" → "Urejeno. Sprememba je
  vidna na testni strani · Odpri testno stran"; failure / unknown / slow (>5 min) / discarded texts. Publish and
  undo the same for the live site. Poll every 5 s while anything is deploying.
- Agent prompt: do not claim the change is already visible.

## Acceptance
- "Done" never appears before the status reports the change's own commit (or a newer one) as built.
- A status answer for the previous commit (race with the edit) does not resolve the change.
- Older changes resolve with the newer commit; discard stops waiting.
- Tests for all of the above; deliberate break of the commit check makes a test fail.
