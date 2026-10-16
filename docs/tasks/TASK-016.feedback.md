# TASK-016 — feedback (implementer)

## Done
- Migration `0004_demo.sql` (`demo_sandboxes`, `demo_edits`).
- `apps/api/src/demo/` (`sandbox.ts`, `external.ts`, `routes.ts`), wired in `app.ts` / `worker.ts`
  (`demoFromEnv`); `runEdit` takes `extraRules` (appended to the system prompt; part of the prompt cache key).
- Widget `Demo.tsx`, `demo-api.ts`, `params.mode`; shared `demoContentMessage`.
- Site `/uredi/demo`, `DemoPreview`, `SiteChrome` (header/footer shared with the real layout), `lib/demo.ts`.
- Docs: ADR-015, `technical/demo.md`, `runbooks/demo.md`, CHEATSHEET.

## Proof
- `pnpm lint && pnpm typecheck && pnpm test`: api 248, widget 104, shared 50, site-schema 42, embed 21 — all pass.
- `apps/site` static build lists `○ /uredi/demo`; `pnpm check` passes with the CI editor origin.
- Real Chromium (Playwright) against a local harness (the real Hono app with SQLite, real site build and widget
  build, a fake model that adds "Ričet s klobaso 8,90 €"): desktop 1360×820 and phone 390×844 — counter 0 → 1,
  preview switched to "Meni" and scrolled to the new dish, in-preview link "O nas" switched pages without leaving
  the URL, after 5 edits the e-mail form appeared, after the e-mail the counter showed "5 od 15".
- Not proven yet: real Haiku edits and Turnstile on dev (owner test after deploy).
