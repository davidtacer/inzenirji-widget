# Tasks

| Task | Title | Depends on | Status |
|---|---|---|---|
| TASK-001 | Monorepo scaffold, tooling and CI | — | Built — PR open, awaiting CI + merge |
| TASK-002 | Deploy skeleton to dev environment | 001, ADR-006 | Blocked (hosting decision) |
| TASK-003 | Embed ↔ widget postMessage protocol (versioned, origin-checked) | 001 | Planned |
| TASK-004 | Auth: magic link + token exchange (ADR-008) | 003 | Planned |
| TASK-005 | Content adapter: read/write client repo via GitHub App (`content/` only), commit to `dev`, merge, revert | 001 | Planned |
| TASK-006 | Agent loop level 1: tools over JSON, schema validation, step limits, cost metering (micro-euros) | 005 | Planned |
| TASK-007 | Widget chat UI: send, show result, test-site link, price, Publish, Undo | 003, 004, 006 | Planned |
| TASK-008 | Screenshots of preview (desktop + phone) | 005, ADR-006 | Planned |
| TASK-009 | Payments: Stripe credit, ledger, limits, estimate before send | 006 | Planned (phase 3) |
| TASK-010 | Level 2 via Managed Agents | 006 | Planned (phase 4) |
