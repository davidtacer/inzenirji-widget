# TASK-007 feedback
Status: PARTIAL — built, unit-tested and checked in a real browser (real local login; the site routes were
answered by a browser-side mock because the session has no GitHub/Anthropic keys). Live run after the morning setup.

## What I implemented
Editor view for signed-in owners: status bar with test/live links, build state, unpublished count and
publish/discard/undo with inline confirmation; chat with replies, cost per edit and notices; composer;
status polling while the preview builds; session end on 401. Strings in sl + en.

## Bugs found in the browser run and fixed
- The editor's reply bubble stretched over the whole chat: the container and the bubble shared the class `editor`.
  Container renamed to `editor-view`.

## Test results (2026-10-14 ~00:25 +02:00)
```
apps/widget  Tests  69 passed (69)   (editor 21, auth 27, …)
```
Browser (Chromium, 390×844 and 1280×860): login with a real local link → status bar → message sent with Enter →
reply with "Strošek: 0,06 €" → "Neobjavljene spremembe: 1" → publish with confirmation → "Objavljeno" and
"Vse spremembe so objavljene." No console errors. Screenshots checked.

## NOT RUN
- Against the real API with GitHub + Claude (needs secrets).
