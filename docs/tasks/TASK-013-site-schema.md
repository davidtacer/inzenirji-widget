# TASK-013 — Per-site content schema (ADR-013)

## Why
Owner 2026-10-14: every site is built by us, unique, with its own blocks; the editor must not be limited to a
fixed set of template blocks ("ne želim da smo omejeni glede na vsebino in obliko spletne strani").

## Scope
- Site repo publishes `<contentRoot>/schema.json` `{version: 1, notes, site, page}` (JSON Schema 2020-12),
  generated from the site's zod schema; CI checks it is up to date.
- API reads the schema with the content on every edit; the agent prompt and every write validation come from it
  (`@cfworker/json-schema`, Workers-safe). No dependency of the API on `@inzenirji/site-schema`.
- Readable validation errors (only the block kind that was written).
- Missing/invalid schema → `503 site_schema_invalid` (reason logged), widget shows "not connected".
- Demo: refinements → regexes; `schema.json` on `dev`, `demo/dev`, `demo/main`.
- Contract for developers/agents building new sites: `docs/guides/site-contract.md`.

## Acceptance
- A site with a block type the demo does not have is edited; demo blocks are rejected there; its prompt has no
  demo content (test).
- Invalid writes never reach a commit; deliberate break of the validation and of the error filter fail tests.
- Demo editing keeps working after deploy (owner test).
