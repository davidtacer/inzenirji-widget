# Architecture

Status labels: **Live** · **Built** · **Planned**.

## Components
| # | Component | Where | Status |
|---|---|---|---|
| 1 | Embed script (`packages/embed`) | `https://uredi.inzenirji.si/embed.js`, loaded by the client's `/uredi` page | Planned |
| 2 | Widget (`apps/widget`) | `https://uredi.inzenirji.si/` inside an iframe | Planned |
| 3 | Urejevalnik API (`apps/api`) | `https://uredi.inzenirji.si/api/*` (same origin as widget) | Planned |
| 4 | Claude API | Messages API (level 1), Managed Agents (level 2) | Planned |
| 5 | GitHub | client repo, branches `dev` and `main`, our GitHub App | Planned |
| 6 | Hosting | builds `dev.<site>` (hidden) and `<site>` from `main` | Planned (ADR-006) |
| 7 | Screenshot service | headless browser (Playwright or hosted) | Planned |
| 8 | Payments | Stripe prepaid credit | Planned |

Only the API holds secrets (Anthropic key, GitHub App key, Stripe key, session secret).
The client site stays static; the embed script is the only thing it loads from us.

## Embedding (ADR-002)
```
their-site.si/uredi  (static page from the template)
  └─ <script src="https://uredi.inzenirji.si/embed.js" data-site="<siteId>" defer></script>
       └─ creates a full-viewport <iframe src="https://uredi.inzenirji.si/?site=<siteId>&origin=<page origin>">
            └─ widget (Preact) ──fetch──▶ /api/* (same origin, Hono)
```
- Embed ↔ widget talk only through `postMessage` with a strict origin check on both sides and a
  versioned message schema in `packages/shared`.
- Widget and API share an origin, so the API needs no CORS for the widget.

## Auth across the iframe (ADR-008, Proposed)
Third-party cookies in iframes are blocked or partitioned by browsers. Plan:
1. Magic link points to `their-site.si/uredi#token=<one-time token>` (first-party page, fragment never sent to servers).
2. Embed script reads the fragment, removes it from the URL and posts it to the iframe.
3. Widget exchanges it at `POST /api/auth/exchange` for a short-lived session token, kept in memory
   and in the iframe's (partitioned) sessionStorage; sent as `Authorization: Bearer`.
4. Every API call checks that the session belongs to the requested site (never trust `siteId` from the client alone).

## Data
Planned storage (choice follows the hosting decision): sites, users, sessions, conversations, change log
(commit SHA, cost, price), credit ledger (append-only, integer amounts).

## Environments
| Env | Widget + API | Client sites used | Status |
|---|---|---|---|
| local | `pnpm dev` | a test repo | Built after TASK-001 |
| dev | `uredi-dev.inzenirji.si` | our test site | Planned |
| prod | `uredi.inzenirji.si` | real clients | Planned |

## CI/CD
GitHub Actions on every PR to `dev`: install (frozen lockfile) → lint → typecheck → unit tests → build
→ embed size check. Deploy pipeline Planned (depends on ADR-006).
