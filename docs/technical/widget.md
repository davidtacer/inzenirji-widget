# Widget — `apps/widget`

Status: **Built** (shell only; not deployed).

## What it does today
A Preact app rendered inside the embed iframe at `https://uredi.inzenirji.si/?site=…&origin=…&lang=…`.
- `src/params.ts` validates query params: `site` (site id rules), `origin` (must be an exact http(s)
  origin, else null), `lang` (`en*` → English, everything else Slovenian).
- `src/App.tsx` shows the header (title, site id, "Zapri"), or an alert for an invalid site.
  On mount with a valid site it posts `widget:ready`; "Zapri" posts `widget:close`.
- `src/parent.ts` posts only to the validated parent origin and only when framed; never to `"*"`.
- `src/i18n.ts` holds every visible string in `sl` and `en` (same keys, test-enforced).
- `src/styles.css` uses CSS custom properties as design tokens, with a dark-mode set.
  Placeholder palette until the Inženirji.si brand tokens are wired in.
- `index.html` has `noindex, nofollow`.

## Local development
`pnpm dev` (root) starts the API on :8787 and the widget on :5173 (`/api` proxied to the API).
Open http://localhost:5173/demo/uredi.html — a stand-in client page that loads `/embed.js`
with `data-site="demo-site"`. The demo page and editor share an origin locally; in production they differ.

## Build
`vite build` → `dist/` (index.html, hashed assets, `embed.js` copied from `packages/embed/dist`).
Size on 2026-10-13: JS 6.48 KB gzipped, CSS 0.61 KB gzipped.
