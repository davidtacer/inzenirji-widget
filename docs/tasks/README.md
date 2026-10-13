# Tasks

| Task | Title | Depends on | Status |
|---|---|---|---|
| TASK-001 | Monorepo scaffold, tooling and CI | — | Done (PR #1, merged 2026-10-13) |
| TASK-002 | Deploy skeleton to dev environment (Cloudflare Worker, `uredi-dev.inzenirji.si`) | 001, ADR-009 | Done — Live on dev (PR #2) |
| TASK-003 | Embed ↔ widget postMessage protocol (versioned, origin-checked) | 001 | Planned |
| TASK-004a | Auth API: D1, magic link mail, exchange, sessions, limits (ADR-010) | 002 | Done (PR #4) |
| TASK-004b | Auth UI: embed passes `#login` token, widget login form + session | 004a | Done — Live on dev (PR #5) |
| TASK-005 | Content adapter: read/write client repo via GitHub App (`content/` only), commit to `dev`, merge, revert | 001 | Planned |
| TASK-006 | Agent loop level 1: tools over JSON, schema validation, step limits, cost metering (micro-euros) | 005 | Planned |
| TASK-007 | Widget chat UI: send, show result, test-site link, price, Publish, Undo | 003, 004b, 006 | Planned |
| TASK-008 | Screenshots of preview (desktop + phone) | 005, ADR-009 | Planned |
| TASK-009 | Payments: Stripe credit, ledger, limits, estimate before send | 006 | Planned (phase 3) |
| TASK-010 | Level 2 via Managed Agents | 006 | Planned (phase 4) |
