# TASK-011 feedback
Status: PARTIAL — built and proven locally (build, checks, real Cloudflare runtime, browser on desktop + phone);
the demo deploy runs once the `demo/dev` and `demo/main` branches exist (see HANDOFF).

## What I implemented
`packages/site-schema` (zod content schema, validation, JSON Schema export, price formatting), `apps/site`
(Next.js 16 static export, 9 block types, theme from content, header/footer route group, `/uredi` per ADR-011,
robots, sitemap, `_headers`, preview mode), fictional demo content with SVG images, build checks in CI,
demo deploy workflow (`site-demo.yml`) and wrangler config for two static Workers.

## Deviations
- The template lives in this monorepo for now (ADR-012) instead of its own repo.
- Content schema answers ADR-007 for now: shared package `@inzenirji/site-schema`.
- Static Worker with assets instead of Cloudflare Pages (same as the editor; no extra token permission needed).

## New dependencies
next@16.4.0, react@19.3.0, react-dom@19.3.0, @types/react, @types/react-dom (template); wrangler (site deploy).

## Test results (2026-10-13 ~23:30 +02:00)
```
site-schema  Tests  42 passed (42)
next build: ✓ Generating static pages (8/8) — /, /meni, /o-nas, /uredi, /robots.txt, /sitemap.xml
pnpm check: all build checks passed (12 checks; preview: 14)
```
Real Cloudflare runtime (`wrangler dev --env live`):
```
/            200 text/html
/meni        200 text/html
/o-nas       200 text/html
/uredi       200 text/html  x-robots-tag: noindex, nofollow
/robots.txt  200 text/plain
/sitemap.xml 200 application/xml
/ne-obstaja  404 text/html
```
Browser (Chromium 1280×900 and 390×844): home and menu render correctly (screenshots checked);
`/uredi` opens the local editor iframe at 0,0 full viewport, no site header, login form visible, no console errors.

## Deliberate breaks
1. robots.txt without `Disallow: /uredi` → `FAIL robots.txt has Disallow: /uredi` · 1 check(s) failed. Restored → all passed.
2. `/uredi` without `robots: { index: false }` → `FAIL /uredi has meta robots noindex, nofollow`. Restored → all passed.
3. Schema: menu prices `-1`, `6.5`, `"6,50"`, links `//evil.example`, `javascript:`, image `../`, slug `uredi` → all rejected (tests).

## NOT RUN
- Deploy to demo-dev / demo.inzenirji.si — needs the demo branches (and runs on push); the session cannot reach those URLs.

## Open questions / risks
- Each content edit triggers a Next.js build (~1–2 min in Actions). Fine for the demo; Pages build limits apply later.
