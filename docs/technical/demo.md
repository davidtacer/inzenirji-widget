# Public editor demo (TASK-016, ADR-015) — Live (dev editor)

## What the visitor sees
`https://demo.inzenirji.si/uredi/demo`: the demo restaurant on the left (on phones: top half), the editor chat on
the right (bottom half). Suggestion chips, a counter "Spremembe: x od y", "Objavi v živo" (only explains, nothing
goes live) and "Začni znova" (content back to the start; the counter stays). After 5 edits the chat asks for an
e-mail (and optionally a website) for 10 more; after all 15 it shows the booking link (Google Calendar, same as inzenirji.si).

## How it works
```
demo page (apps/site, static)          widget iframe ?mode=demo (apps/widget)          API (apps/api)
  renders content in the browser  <--- postMessage widget:demo-content ---  Demo.tsx  --->  /api/demo/*
  validates it with site-schema                                                        D1 demo_sandboxes / demo_edits
```
- `apps/site/app/uredi/demo/page.tsx` renders `DemoPreview` with the build-time content (instant first paint).
  `DemoPreview` accepts messages only from the editor origin and the iframe's window, validates the content with
  `validateContent` (same zod schema as the build) and renders it with the site's own `BlockView`, `SiteHeader`,
  `SiteFooter`. Links inside the preview switch pages; `tel:`/`mailto:` are ignored; other links open a new tab.
  After a change it switches to the changed page and scrolls to the first changed block (`firstChangedBlock`).
- `apps/widget/src/Demo.tsx`: boot = `GET config` → stored token (`localStorage` `inzenirji:demo`) → `GET state`,
  else Turnstile (when configured) → `POST start`. Slovenian only.
- `apps/api/src/demo/routes.ts` (`/api/demo`):

| Route | Auth | Does |
|---|---|---|
| `GET /config` | — | Turnstile site key (or null), free and e-mail edit counts |
| `POST /start` `{turnstileToken}` | Turnstile if configured | new sandbox from the live demo content; per-IP limit; cleanup of expired rows; sends pending leads |
| `GET /state` | sandbox token | content + counter (401 `sandbox_expired`) |
| `POST /edit` `{message ≤ 500}` | sandbox token | limits → `runEdit` (Haiku, `DEMO_RULES`) → content updated, `demo_edits` row with cost; returns `pages` it changed |
| `POST /edit` multipart `{message, images ≤ 3}` | sandbox token | same, with images (JPEG/PNG/WebP by bytes, ≤ 1.5 MB, widget resizes first); only images the new content uses are stored in `demo_images` |
| `GET /images/<id>.<ext>` | — (unguessable id) | serves a stored image while its sandbox lives (`nosniff`, CSP `default-src 'none'`); deleted with the sandbox after 24 h |
| `POST /reset` | sandbox token | content back to the template, counter unchanged |
| `POST /email` `{email, website?}` | sandbox token | stores the lead once, +10 edits, sends pending leads to the CRM |
| `GET /stats?days=30` | CRM token | funnel: visits, edited, emails, edits, cost |

Errors: 402 `email_required` / `demo_limit`, 429 `rate_limited`, 503 `demo_paused` (daily cap), 503
`demo_unavailable` (no template / no API key), 502 `agent_unavailable`, 403 `captcha_failed`.

- Template: `templateLoader` reads `demo/main` of the site `DEMO_SITE` through the normal GitHub store, cached
  10 minutes per isolate.
- Sandbox token: 32 random bytes, stored only as SHA-256 (`token_hash`). Content `NULL` after 24 h; rows and
  `demo_edits` deleted after 90 days (both on `POST /start`).
- Leads: `flushLeads` POSTs `{ref, email, website, startedAt, emailAt, edits[]}` with `Authorization: Bearer
  <CRM_LEADS_TOKEN>` to `CRM_LEADS_URL`; `lead_sent_at` is set on 2xx; failures are retried on the next start/e-mail
  (only leads from the last 7 days). Without the CRM config leads wait in D1.
- Cost: `demo_edits.cost_micros` (micro-euros, ADR-005); the cap compares today's sum (UTC day) with
  `DEMO_DAILY_CAP_EUR`.

## Configuration
Vars (`apps/api/wrangler.jsonc`): `DEMO_SITE`, `DEMO_MODEL`, `DEMO_DAILY_CAP_EUR`, `CRM_LEADS_URL`.
Secrets: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CRM_LEADS_TOKEN` (runbook: `docs/runbooks/demo.md`).
The demo page loads the editor from `NEXT_PUBLIC_EDITOR_ORIGIN` (dev editor for now).
