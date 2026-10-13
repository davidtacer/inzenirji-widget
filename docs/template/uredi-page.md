# Site template — the `/uredi` page (boilerplate)

Implemented in `apps/site` (TASK-011, see `docs/technical/site.md`).

Requirements for every client site (landing) built from the Inženirji.si template, so the editor works the
same everywhere. The template lives in its own repo; this file is the source of truth until it exists there.
Owner decision 2026-10-13.

## Requirements
1. **Path:** `/uredi` on the client's own domain (e.g. `https://hisa-denk.si/uredi`). No subdomain.
2. **Content:** only the embed script — no other text, images or tracking:
   ```html
   <script src="https://uredi.inzenirji.si/embed.js" data-site="<siteId>" defer></script>
   ```
   `<siteId>` = the site's id in the editor database (lowercase, digits, hyphens; e.g. `hisa-denk`).
   On dev: `https://uredi-dev.inzenirji.si/embed.js`.
3. **Search engines — the page must not be visible to them:**
   - `<meta name="robots" content="noindex, nofollow">` in the page head;
   - `X-Robots-Tag: noindex, nofollow` response header for `/uredi` (Cloudflare Pages `_headers`);
   - `robots.txt` contains `Disallow: /uredi`;
   - `/uredi` is **not** in `sitemap.xml`;
   - no link to `/uredi` anywhere on the site (the owner opens it from the e-mail link or a bookmark).
4. **Look:** no site header, navigation or footer, no cookie banner — the editor iframe covers the whole
   screen. Body without margin, background white, `viewport` meta set.
5. **Other:** `<title>Urejevalnik</title>`, `lang="sl"`, no analytics or third-party scripts on this page
   (the login token is in the URL hash for a moment).

### Why both `noindex` and `Disallow`
`Disallow` stops crawling, but a crawler that may not fetch the page also cannot see its `noindex`; a URL that
is linked from somewhere can then still appear in results without content. That is why the page is never
linked, and why the `X-Robots-Tag` header is also sent: crawlers that do fetch it (or ignore robots.txt) get
the `noindex`.

## Static HTML version
`public/uredi/index.html` (or `uredi.html`, depending on the host's routing):
```html
<!doctype html>
<html lang="sl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Urejevalnik</title>
    <style>html,body{margin:0;height:100%;background:#fff}</style>
  </head>
  <body>
    <script src="https://uredi.inzenirji.si/embed.js" data-site="hisa-denk" defer></script>
  </body>
</html>
```

## Next.js (App Router, static export) version
Put the normal site pages in a route group with the header/footer layout, and `/uredi` outside it:
```
app/
  layout.tsx              root: <html><body>{children}</body></html> only — no header/footer here
  (site)/layout.tsx       header + footer + cookie banner for all normal pages
  (site)/page.tsx         home, other pages …
  uredi/page.tsx          the editor page (no header/footer)
  robots.ts
  sitemap.ts
public/_headers           Cloudflare Pages headers
```

`app/uredi/page.tsx`
```tsx
import type { Metadata } from "next";
import Script from "next/script";
import site from "@/content/site.json";

export const metadata: Metadata = {
  title: "Urejevalnik",
  robots: { index: false, follow: false },
};

export default function UrediPage() {
  return (
    <Script
      src={process.env.NEXT_PUBLIC_EDITOR_ORIGIN + "/embed.js"} // https://uredi.inzenirji.si
      data-site={site.id}
      strategy="afterInteractive"
    />
  );
}
```
The embed reads `document.currentScript`; if a framework injects the script without it being "current",
use a plain `<script src=… data-site=… defer>` in the HTML head instead and check in the browser that the
editor opens.

`app/robots.ts`
```ts
import type { MetadataRoute } from "next";
import site from "@/content/site.json";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/uredi"] }],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
```

`app/sitemap.ts` — built from the content pages only; `/uredi` is never added. Test it: the generated
`sitemap.xml` must not contain `/uredi`.

`public/_headers`
```
/uredi
  X-Robots-Tag: noindex, nofollow
/uredi/*
  X-Robots-Tag: noindex, nofollow
```

## Checklist when a site goes live
- [ ] `https://<site>/uredi` opens the editor full screen on phone and desktop.
- [ ] Page source has `noindex, nofollow`; response header `X-Robots-Tag: noindex, nofollow`.
- [ ] `https://<site>/robots.txt` contains `Disallow: /uredi`.
- [ ] `https://<site>/sitemap.xml` does not contain `/uredi`.
- [ ] No link to `/uredi` on the site.
- [ ] Site and owner added in the editor database (`docs/runbooks/add-site-user.md`), `origin` = the site's
      exact address (with or without `www`, as the site is served).
