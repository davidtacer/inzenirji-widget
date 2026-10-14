# Runbook — the Inženirji.si GitHub App (TASK-014)

The editor reaches client repos through a GitHub App: the client (or we, for repos we own) installs it on the site
repo; the API then gets a 1-hour token for exactly that repo with Contents write + Checks read + Metadata read.
No personal tokens of clients. Code: `apps/api/src/content/github-app.ts`; selection in `apps/api/src/worker.ts`
(`tokenSourceFor`: app first; a repo without the app falls back to `GITHUB_TOKEN` if that secret exists).

## Create the app (once, owner)
1. https://github.com/settings/apps/new (for an organisation: Organisation → Settings → Developer settings →
   GitHub Apps → New).
2. **GitHub App name**: e.g. `Inzenirji urejevalnik` (must be unique on GitHub). **Homepage URL**:
   `https://inzenirji.si`.
3. **Webhook**: untick **Active** (the editor does not use webhooks).
4. **Repository permissions**: **Contents: Read and write**, **Checks: Read-only** (Metadata: Read-only is
   added automatically). Nothing else; no account permissions; no events.
5. **Where can this GitHub App be installed?** → **Any account** (so clients can install it on their repos).
6. **Create GitHub App**. On the app page note the **App ID** (a number).
7. **Private keys → Generate a private key** → a `.pem` file downloads. Keep it safe; never commit it or paste it
   in a chat.
8. **Install App** (left menu) → your account → **Only select repositories** → `inzenirji-widget` (the demo site
   lives there) → Install.

## App page (as set up 2026-10-14)
- Name `Inzenirji urejevalnik` (slug `inzenirji-urejevalnik`; renaming changes the public link), App ID 5312521,
  public install link `https://github.com/apps/inzenirji-urejevalnik`, public (installable by any account).
- Webhook off, no OAuth during installation, no device flow, no callback/setup URL.
- Logo: `docs/assets/github-app-logo.png` (512×512, green "I_" on black, brand colours), badge colour `000000`.
- Description (Markdown):

```markdown
**Urejevalnik spletnih strani Inženirji.si**

Vsebino svoje spletne strani urejate sami – v pogovoru, v slovenščini. Napišete na primer »Bučna juha naj stane 6,50 €«, urejevalnik spremembo pripravi na skriti testni strani, vi pa jo pregledate in z enim klikom objavite. Vsako objavo lahko razveljavite.

**Do česa ima dostop**
- Samo do repozitorijev, ki jih izberete ob namestitvi. Izberite samo repozitorij svoje spletne strani.
- Zapisuje izključno datoteke z vsebino strani (besedila, cene, podatke). Kode in dizajna strani ne spreminja.
- Bere stanje objave, da vam pokaže, kdaj je sprememba vidna.

**Česa ne počne**
- Ne dostopa do drugih repozitorijev, nastavitev računa, skrivnosti ali članov.
- Ne zbira podatkov obiskovalcev vaše strani.

Namestitev lahko kadarkoli odstranite: GitHub → Settings → Applications.

Vprašanja: hello@inzenirji.si · [inzenirji.si](https://inzenirji.si)
```

## Give the keys to the editor (owner)
Cloudflare → Workers & Pages → `inzenirji-editor-dev` (later also production) → Settings → Variables and Secrets →
Add, type **Secret**:
- `GITHUB_APP_ID` = the App ID from step 6;
- `GITHUB_APP_PRIVATE_KEY` = the whole content of the `.pem` file (open it in a text editor, copy everything
  including the `-----BEGIN …-----` and `-----END …-----` lines). Literal `\n` instead of line breaks also works.
Deploy (saving secrets redeploys the Worker). Check: the demo editor still edits and shows "Urejeno".
Then `GITHUB_TOKEN` can be deleted (and the fine-grained token revoked on GitHub) — or kept as a fallback for
repos without the app during the transition.

## A new client repo
1. The site repo follows `docs/guides/site-contract.md`.
2. Install the app on that repo: the client opens `https://github.com/apps/<app-slug>/installations/new` and picks
   only that repo (or, if we own the repo, we install it). The app slug is in the app's public URL.
3. Register the site in D1 (`sites`, `site_users`, `site_repos` with owner/repo/branches/content root/URLs).
   No token per site is needed: the API finds the installation from owner/repo.

## Errors
- Owner sees "Ta stran še ni povezana z urejevalnikom" and the API logs `github_not_installed` → the app is not
  installed on that repo (or the repo was not selected in the installation).
- `github_unavailable` (502) with `unauthorized` in the log → wrong App ID or private key; regenerate the key and
  update the secret.

## Rotate the key
App settings → Private keys → Generate a new one → update `GITHUB_APP_PRIVATE_KEY` → delete the old key on GitHub.
