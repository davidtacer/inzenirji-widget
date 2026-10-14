# TASK-014 — feedback

## Proof (2026-10-14)
- `pnpm lint && pnpm typecheck && pnpm test` green: 363 tests (api 171, widget 79, shared 50, site-schema 42,
  embed 21); Worker dry run OK (162 KB gz).
- Tests use a real 2048-bit RSA key pair: the app JWT from a PKCS#1 key (GitHub's format), a PKCS#8 key and a key
  pasted with literal `\n` verifies with the public key (RS256, iss, iat −60 s, exp ≤ 10 min); installation token
  request names only the repo and contents:write / checks:read / metadata:read; reuse until 5 min before expiry,
  then renewal with a new JWT; not installed → `not_installed`; wrong key → `unauthorized`; worker selection
  (none / token only / app / fallback only on not installed); route → `503 github_not_installed`; widget message.
- Deliberate breaks: no PKCS#1 → PKCS#8 wrapping → 6 tests fail; fallback on any app error → 1 test fails.

## Live (2026-10-14 10:34)
- Owner created and installed the app; a real edit was committed by `inzenirji-urejevalnik[bot]` (demo/dev be16cb1),
  so the app path (JWT → installation → token) works on Cloudflare Workers.
