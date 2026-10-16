# TASK-016 — Public editor demo

## Why
Owner 2026-10-16 chose "Javni demo urejevalnika" (product plan §6 in the inzenirji.si repo): every visitor can
change the demo site in 30 seconds and see the result; at the end we ask for an e-mail (a lead).

## Scope (ADR-015)
- API `/api/demo/*`: sandbox per visitor in D1 (never git), started from the live demo content; same agent and
  schema validation, Haiku, demo moderation rules; 5 free edits, +10 after an e-mail; Turnstile when configured;
  per-IP limits; daily cost cap; 24 h expiry; leads to the CRM; funnel numbers for the CRM.
- Widget `?mode=demo`: chat, suggestion chips, counter, e-mail form, reset, "publish" explanation, booking link;
  sends the content to the demo page.
- Demo site page `/uredi/demo`: renders sandbox content in the browser with the site's components (validated),
  in-preview navigation, scroll + flash on the changed block, desktop and phone layout.
- Out of scope: other industries (salon, service), automatic "your site could look like this" e-mail with a mockup
  (CRM, on-demand mockups), production editor host.

## Acceptance
- Unit/route tests for every limit, the lead hand-off and the stats token; widget tests for the flow.
- Real browser (desktop + phone): suggestion → change visible in the preview on the right page; e-mail gate after 5.
- After deploy: owner opens the demo and makes a real change (real Haiku).
