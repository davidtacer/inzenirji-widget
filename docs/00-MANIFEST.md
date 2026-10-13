# Manifest — rules for agents

Read `docs/DEVELOPMENT-RULES.md` before any task. This file only adds what is specific to this repo.
ADRs in `docs/03-DECISIONS.md` override both files.

## What this repo is
The conversational site editor ("Urejevalnik s pogovorom") for Inženirji.si client websites:
an embed script for the client's site, the editor UI that runs in an iframe, and the API that talks to
Claude, GitHub and payments. The client website template (Next.js, blocks + JSON content) lives in a
separate repo; this repo only reads and writes its `content/` and `public/uploads/` through the GitHub API.

## Roles
- Owner: David Tacer (product decisions, accounts, secrets, hosting, GitHub settings, prod).
- CTO + implementer: AI agent in working mode B (see HANDOFF).

## Never
- Never put a secret (Anthropic key, GitHub App private key, Stripe key, session secret) in the repo,
  chat, logs, test fixtures or screenshots. Name the variable, the owner pastes the value.
- Never send the Anthropic key, GitHub tokens or payment keys to the browser. Only `apps/api` holds them.
- Never let the AI write outside `content/` and `public/uploads/` of a client repo (enforced server-side).
- Never write to a client's `main` branch except by merging `dev` after the client clicked "Publish".
- Never use floats for money. Customer prices in integer euro cents, AI cost in integer micro-euros (ADR-005).
- Never touch uat/prod, DNS or hosting accounts; the owner does that.

## Stack (fixed — new dependencies need a justification in the PR and an ADR if non-trivial)
TypeScript strict · Node 22 · pnpm workspaces · Preact + Vite · Hono · zod · Vitest · Biome.

## Layout
```
apps/widget       editor UI (Preact), served from uredi.inzenirji.si, runs inside an iframe
apps/api          Urejevalnik API (Hono): auth, agent loop, GitHub, previews, billing
packages/embed    tiny script loaded by the client's /uredi page; creates the iframe
packages/shared   zod schemas and types shared by widget and API (messages, API contracts)
docs/             source of truth (see DEVELOPMENT-RULES §3)
```

## Quality bar
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green locally and in CI.
UI strings through i18n (Slovenian first, English second). Embed script stays tiny (budget in ADR-002).
