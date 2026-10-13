# Embed script — `packages/embed`

Status: **Live** on dev (`https://uredi-dev.inzenirji.si/embed.js`); login handoff Built (TASK-004b).

## What it does
The client site's `/uredi` page loads one classic script:
```html
<script src="https://uredi.inzenirji.si/embed.js" data-site="hisa-denk" defer></script>
```
On load (`src/index.ts` → `mount()` in `src/embed.ts`) it:
1. Reads `data-site` from its own `<script>` tag (`document.currentScript`, so it must be a classic script,
   not `type="module"`). Invalid or missing → `console.error`, nothing mounted.
2. Resolves the editor origin from the script's own `src` (`data-editor-origin` overrides it, used for local dev).
3. Reuses an existing `#inzenirji-editor` iframe if present (loading twice is harmless).
4. Appends a full-viewport iframe: `<editorOrigin>/?site=<id>&origin=<page origin>`.
5. Listens for `postMessage`. A message is handled only if **all** hold: the iframe has a window,
   `event.source` is that window, `event.origin` equals the editor origin, and the data parses as a
   protocol message (`parseWidgetToEmbed`). `widget:close` → `history.back()`, or `location.assign("/")`
   when there is no history.
6. Login link (TASK-004b): if the page URL has `#login=<43-char token>` (on load or on `hashchange`, e.g. a
   link pasted into a tab that already shows /uredi), the hash is removed at once with
   `history.replaceState` (path and query kept) and the token is posted to the iframe as `embed:login` —
   only after the widget has sent `widget:ready`, only to the editor origin, and only once.

## Protocol (`packages/shared/src/embed-protocol.ts`)
Version `1`. Messages are exactly `{ v: 1, type }`; extra keys, other versions or unknown types are dropped.
| Direction | Type | Meaning |
|---|---|---|
| widget → embed | `widget:ready` | widget rendered for a valid site |
| widget → embed | `widget:close` | user pressed "Zapri" |
| embed → widget | `embed:login` (`{ v, type, token }`) | one-time login token from the e-mail link |

The shared protocol file is dependency-free on purpose: the embed bundles it.

## Size budget
≤ 3072 B gzipped (ADR-002), enforced by `pnpm size` in CI (`scripts/check-size.mjs`).
Current: 1164 B gzipped (2026-10-13, TASK-004b).

## Build and serve
`vite build` produces `dist/embed.js` (IIFE). The widget build copies it to its own `dist/embed.js`,
so the embed is served from the widget origin; in dev the widget dev server serves it at `/embed.js`.

## Tests
`src/embed.test.ts` (happy-dom; iframe pages are never loaded, which prints one expected
"Iframe page loading is disabled" line per mounted iframe).
