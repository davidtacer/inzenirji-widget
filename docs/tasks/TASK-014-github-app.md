# TASK-014 — GitHub App for client repos

## Why
Owner 2026-10-14: real clients' sites (built by us) live in their own or our repos; the editor must not hold
personal tokens. A GitHub App installed per repo gives short-lived tokens for exactly that repo.

## Scope
- App auth in the Worker: RS256 app JWT with WebCrypto (PKCS#1 key as downloaded from GitHub, or PKCS#8),
  installation lookup by owner/repo, installation token limited to the repo and to Contents write, Checks read,
  Metadata read; cached until 5 min before expiry.
- Store takes a token source (fixed token or async function).
- Worker: app when `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` are set; repo without the app → `GITHUB_TOKEN`
  fallback if set, else `503 github_not_installed`.
- Runbook for the owner: create, install, secrets, new client, rotate.

## Acceptance
- JWT verifies with the public key (as GitHub verifies it); token request names only the site's repo and the three
  permissions; caching/renewal; not installed / wrong key mapped; fallback only for "not installed".
- Owner creates the app and the demo keeps editing through it (owner test).
