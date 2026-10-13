# Widget — `apps/widget`

Status: **Live** on dev (shell + login; owner-tested 2026-10-13).

## What it does today
A Preact app rendered inside the embed iframe at `https://uredi.inzenirji.si/?site=…&origin=…&lang=…`.
- `src/params.ts` validates query params: `site` (site id rules), `origin` (must be an exact http(s)
  origin, else null), `lang` (`en*` → English, everything else Slovenian).
- `src/App.tsx` shows the header (title, site id, "Zapri"), or an alert for an invalid site.
  On mount with a valid site it posts `widget:ready`; "Zapri" posts `widget:close`.
- Login (TASK-004b, views: checking · signingIn · signedOut · linkSent · signedIn):
  - stored session → `GET /api/auth/me`; 401/403 clears it; no network keeps it and shows a notice;
  - e-mail form → `POST /api/auth/request` → neutral "check your e-mail" (same text for any address);
  - `embed:login` from the parent (source = `window.parent`, origin = validated `origin` param, exact shape)
    → `POST /api/auth/exchange` → session saved; refused link → if a stored session is still valid the user
    stays signed in, otherwise "link no longer valid";
  - only the latest auth operation may change the view (`op` counter), so a slow stored-session check
    cannot overwrite a fresh login;
  - "Odjava" clears the stored session at once and calls `POST /api/auth/logout`.
- Signed in (TASK-007): `src/Editor.tsx` — status bar (links to test and live site, preview build state, number
  of unpublished changes, **Objavi v živo** / **Zavrzi neobjavljeno** / **Razveljavi zadnjo objavo**, each with an
  inline confirmation), chat (owner's messages, editor replies with cost, notices), composer (Enter sends,
  Shift+Enter new line, max 2000 chars). Polls `GET /status` every 10 s while the test site is being rebuilt.
  401 from any site route ends the session. Client: `src/sites-api.ts`.
- `src/api.ts` — same-origin client; network failures become `status 0`; responses are zod-validated.
- `src/session-store.ts` — session in the iframe's localStorage under `inzenirji:session:<siteId>`
  (partitioned per client site by the browser); expired or malformed entries are dropped; every call is
  wrapped because storage can be blocked.
- Dependencies (`api`, `store`, `win`) are created once per mounted app (a new object per render caused an
  endless `/me` loop — regression test in `auth-ui.test.tsx`).
- `src/parent.ts` posts only to the validated parent origin and only when framed; never to `"*"`.
- `src/i18n.ts` holds every visible string in `sl` and `en` (same keys, test-enforced).
- `src/styles.css` uses CSS custom properties as design tokens, with a dark-mode set.
  Placeholder palette until the Inženirji.si brand tokens are wired in.
- `index.html` has `noindex, nofollow`.

## Local development
`pnpm dev` (root) builds, then starts the real Worker (wrangler + local D1) on :8787 and the widget dev server
on :5173 (`/api` proxied). For login, `apps/api/.dev.vars` must contain `MAIL_TRANSPORT=console` (copy
`.dev.vars.example`): the login link is printed in the wrangler terminal. Seed a site whose origin is the page
that embeds the editor (see `docs/runbooks/add-site-user.md`, local: `npx wrangler d1 execute DB --env dev --local`).
Open http://localhost:5173/demo/uredi.html — a stand-in client page that loads `/embed.js`
with `data-site="demo-site"`. The demo page and editor share an origin locally; in production they differ.

## Build
`vite build` → `dist/` (index.html, hashed assets, `embed.js` copied from `packages/embed/dist`).
Size on 2026-10-13 (TASK-004b): JS 33.6 KB gzipped (most of it zod, used to validate API responses), CSS 0.82 KB.
If it matters on slow phones: switch the widget to `zod/mini` or hand-written checks.
