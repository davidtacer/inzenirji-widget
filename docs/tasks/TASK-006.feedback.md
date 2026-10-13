# TASK-006 feedback
Status: PARTIAL — built and unit-proven with a scripted model and an in-memory git; live run needs
`ANTHROPIC_API_KEY` + `GITHUB_TOKEN` (HANDOFF morning steps). No real model call was made (no key in the session).

## What I implemented
Agent loop with 7 tools over JSON, schema validation with error feedback, step/token limits, change detection,
one commit per edit, cost metering in micro-euros and price in cents, edit history in the prompt,
`POST /api/sites/:siteId/edit`, rate limit, logging of every processed request.

## Deviations
- Whole-file `write_page`/`write_site` instead of JSON Patch (ADR-012).
- No screenshot self-check yet (TASK-008).
- Commit message = first line of the owner's request (not a model-written summary).

## Test results (2026-10-14 ~00:10 +02:00)
```
apps/api  Tests  130 passed (130)   (agent 21, edit route 14, …)
worker dry run: Total Upload 894.30 KiB / gzip 152.23 KiB
```

## Deliberate breaks
1. Page validation skipped → 4 failures (validation feedback, slugs "uredi", "../hack", "Velike"). Restored → 46 passed.
2. Home page deletable → "creates and deletes pages; the home page cannot be deleted" fails. Restored → 46 passed.
3. Edit rate limit disabled → "allows 30 edits per hour per site, then 429" fails. Restored → 46 passed.

## NOT RUN
- Real Anthropic API call (prompt quality, tool use behaviour, real token counts and cost).
- Real GitHub commit from the Worker.
- CPU time on Workers Free.

## Open questions / risks
- Prices from third-party summaries; verify on Anthropic's pricing page.
- Model choice: Sonnet 5.5 by default for reliability; Haiku 5.5 is ~20× cheaper — measure in phase 1.
