# TASK-015 — feedback

## Proof (2026-10-14)
- `pnpm lint && pnpm typecheck && pnpm test` green: 408 tests (api 207, widget 88, shared 50, site-schema 42,
  embed 21); `schema:check` green.
- API: image bytes reach the model as an image block with its URL, the last block of the first message is
  prompt-cached, the used image is committed with the page in one commit (bytes checked), unused images are not
  committed, SVG renamed to .jpg / 4 images / site without `uploads` → 400 before the model is called; upload paths
  outside the folder, nested, uppercase, `.svg` or under `.github` are refused by the store; `uploads.dir` with
  `..`, hidden or absolute segments is refused in `schema.json`.
- Widget: pick → resize (stubbed) → thumbnails → send as multipart (File with name), remove, max 3, image without
  text asks where it goes, unreadable image, API error messages.
- Real browser (Chromium, 390×844): a 4000×3000 4 MB JPEG was resized to 1600×1200 JPEG 375 KB and sent as
  multipart with the message; chat showed the thumbnail, "Pripravljam testno stran …", then "Urejeno"; no console
  errors. Demo site with a `references` block rendered on mobile and 1497 px desktop without horizontal overflow.
- Deliberate breaks: committing all attached images → 1 test fails; skipping the byte check → 2 tests fail.

## Not verified here
- Real Claude vision call and real GitHub blob upload (owner test after merge + demo branch update).
- Workers CPU with images: base64 of ~400 KB per image is small, but on Workers Free (10 ms) large images could hit
  1102 — switch to Workers Paid before real clients (ADR-009).
