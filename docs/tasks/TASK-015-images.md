# TASK-015 — Images from the chat + references block

## Why
Owner 2026-10-14 ("ja" to: references block + image upload from the chat). Clients add references, gallery photos
etc. by sending a photo from the phone and saying where it goes.

## Scope
- Site schema `uploads: {dir, publicPath}`; store commits images as git blobs only into that folder with editor-made
  names; API `/edit` multipart (max 3, ≤ 1.5 MB, JPEG/PNG/WebP by magic bytes, no SVG); images to the model with
  their future URL (prompt-cached); only used images committed, in the same commit as the content.
- Widget: image button, in-browser resize (≤ 1600 px), thumbnails, remove, error messages.
- Demo: `references` block (heading, intro, items: name, description, image, link) + `uploads` in its schema.
- Contract updated (`docs/guides/site-contract.md`).

## Acceptance
- A real large photo is shrunk in a real browser and sent as multipart; the model sees it; the used image lands in
  the uploads folder in the same commit; unused images never reach the repo; SVG / too many / no uploads refused
  before any model call; uploads cannot be written outside the folder. Owner test on the demo after merge.
