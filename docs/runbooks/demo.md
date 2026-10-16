# Runbook: public editor demo (TASK-016)

The demo works without these steps (no bot check, leads wait in D1). Do them before advertising the demo.

## 1. Turnstile (bot check)
1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Name: `Demo urejevalnika`. Hostnames: `uredi-dev.inzenirji.si` (later also `uredi.inzenirji.si`).
3. Widget mode: **Managed**. Pre-clearance: No. → Create.
4. Copy **Site Key** and **Secret Key**.
5. Workers & Pages → `inzenirji-editor-dev` → Settings → Variables and Secrets → Add, type **Secret**:
   `TURNSTILE_SITE_KEY` = Site Key, `TURNSTILE_SECRET_KEY` = Secret Key. Save (deploys at once).
6. Check: open the demo in a private window; a short check appears (often invisible), then the counter.

## 2. Leads to the CRM
1. CRM → Nastavitve → **Demo urejevalnika** → **Ustvari ključ**. Copy it (shown once).
2. Workers & Pages → `inzenirji-editor-dev` → Settings → Variables and Secrets → Add, type **Secret**:
   `CRM_LEADS_TOKEN` = the key. Save.
3. Check: in the demo use 5 edits, enter an e-mail; within a minute the company "Demo: …" appears in the CRM
   (Danes → Novi iz demota) and the funnel shows numbers.

## Change limits
Daily cost cap / model: `apps/api/wrangler.jsonc` vars `DEMO_DAILY_CAP_EUR`, `DEMO_MODEL` (PR, deploys on merge).
Edit counts: `FREE_EDITS`, `EMAIL_EDITS` in `apps/api/src/demo/sandbox.ts`.

## Stop the demo
Set `DEMO_DAILY_CAP_EUR` to `0` (every edit answers "paused"), or remove the link on inzenirji.si.
