# Tasks

| Task | Title | Depends on | Status |
|---|---|---|---|
| TASK-001 | Monorepo scaffold, tooling and CI | — | Done (PR #1, merged 2026-10-13) |
| TASK-002 | Deploy skeleton to dev environment (Cloudflare Worker, `uredi-dev.inzenirji.si`) | 001, ADR-009 | Done — Live on dev (PR #2) |
| TASK-003 | Embed ↔ widget postMessage protocol (versioned, origin-checked) | 001 | Planned |
| TASK-004a | Auth API: D1, magic link mail, exchange, sessions, limits (ADR-010) | 002 | Done (PR #4) |
| TASK-004b | Auth UI: embed passes `#login` token, widget login form + session | 004a | Done — Live on dev (PR #5) |
| TASK-005 | Content on GitHub: read/write content files, commit to dev, publish, undo, discard | 011 | Done — Live (PR #9) |
| TASK-006 | Agent loop level 1: tools over JSON, schema validation, step limits, cost metering (micro-euros) | 005 | Done — Live (PR #10) |
| TASK-007 | Widget chat UI: send, show result, test-site link, price, Publish, Undo | 004b, 006 | Done — Live, owner-tested (PR #11) |
| TASK-008 | Screenshots of preview (desktop + phone) | 005, ADR-009 | Planned |
| TASK-009 | Payments: Stripe credit, ledger, limits, estimate before send | 006, ADR-014 | Done — Live in test mode, owner-tested (PR #18) |
| TASK-010 | Level 2 via Managed Agents | 006 | Planned (phase 4) |
| TASK-011 | Site template (phase 0) + demo client site | 002 | Done — Live (PR #8) |
| TASK-012 | Chat shows deploy progress; "done" only when the site serves the change | 007 | Built — PR #12 |
| TASK-013 | Per-site content schema (`schema.json` in the site repo), editor knows no block types | 012, ADR-013 | Done — Live, owner-tested (PR #13) |
| TASK-014 | GitHub App for client repos (replaces the dev token) | 013 | Done — Live, owner-tested (PR #14) |
| TASK-015 | Images from the chat + references block (demo) | 013, 014 | Done — Live, owner-tested (PR #17) |
| TASK-016 | Public editor demo: sandbox per visitor, 5 + 10 edits, e-mail lead to CRM, Turnstile, cost cap (ADR-015) | 013, ADR-015 | Live (PR #22, #23, #25; images in the demo: migration 0005, PR open); real Haiku edit verified in a browser 2026-10-16; Turnstile + CRM key pending (owner) |
