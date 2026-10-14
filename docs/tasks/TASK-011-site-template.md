# TASK-011 — Site template (phase 0) + demo client site
Depends on: TASK-002. Read first: ADR-005, ADR-011, ADR-012, docs/template/uredi-page.md, product plan §1, §6.

## Goal
A client site built from blocks and JSON content, deployable as a static site, with a `/uredi` page per ADR-011.
A demo site ("Gostilna Pri Lipi", fictional) runs at https://demo-dev.inzenirji.si (from `demo/dev`) and
https://demo.inzenirji.si (from `demo/main`).

## Scope
- `packages/site-schema`: zod schemas for `site.json` and pages (blocks: hero, notice, text, services, menu,
  gallery, hours, contact, faq), prices as integer cents, JSON Schema export for the agent; content validator.
- `apps/site`: Next.js (App Router, `output: "export"`), renders `content/site.json` + `content/pages/*.json`;
  theme colours/fonts from `site.json`; `(site)` route group with header/footer; `/uredi` without them;
  `robots.txt` with `Disallow: /uredi`; `sitemap.xml` without `/uredi`; `_headers` with `X-Robots-Tag` for `/uredi`
  (and for the whole preview site when `SITE_PREVIEW=1`).
- Demo content (fictional, Slovenian), SVG images.
- `.github/workflows/site-demo.yml`: on push to `demo/dev` / `demo/main` build and deploy the static site as a
  Worker with assets on the custom domain; smoke test.

## Tests
Schema accepts the demo content and rejects bad blocks, negative/float prices, unknown block types, bad slugs;
build output: every page exists, `/uredi` has noindex and the embed script, `robots.txt` and `sitemap.xml` rules,
`_headers`.

## Acceptance
CI green; local build + browser check of home, a subpage and `/uredi` (desktop and phone).
