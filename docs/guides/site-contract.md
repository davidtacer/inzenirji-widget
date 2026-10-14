# Site contract — what a website must have so the Inženirji.si editor can edit it

Audience: a developer (human or AI agent) building a new client website **without** knowing how the editor works.
Follow this file and the site will be editable through the chat editor. Source of truth: ADR-011, ADR-012,
ADR-013 in `docs/03-DECISIONS.md`. Working example: `apps/site` (demo "Gostilna Pri Lipi").

## 1. The idea in one paragraph
The site's **design lives in code** and is free: any framework that builds a static site, any components, any
layout. Everything the owner may change through the editor is **JSON content** in the repo, and the site
**publishes a schema** that says exactly what that JSON may contain. The editor (an AI agent behind a chat) reads
the schema and the JSON from GitHub, edits only the JSON, validates every change against the schema, and commits
it to the test branch. Publishing merges the test branch into the live branch. The editor never touches code,
styles or the schema. So: the site can look like anything; what is editable is what you put in the schema.

## 2. Repository layout (required)
```
<contentRoot>/schema.json        the content schema (generated, committed) — §3
<contentRoot>/site.json          site-wide content (name, contact, navigation, …) — required, shape is yours
<contentRoot>/pages/<slug>.json  one file per page; "index" is the home page — required: index.json
```
- `<contentRoot>` is any folder, e.g. `content` (demo: `apps/site/content`). It is stored per site in the editor
  database (`site_repos.content_root`).
- File names of pages are **slugs**: lowercase letters, digits and hyphens, max 64 chars, `index` = home page,
  `uredi` is reserved (§6). Each page JSON has `"slug"` equal to its file name.
- Nothing else in the repo is ever written by the editor. Images the content refers to live in your static folder
  (demo: `public/uploads/`) and are referenced by path (`/uploads/x.jpg`) or https URL.
- The repo must be **private** for real clients: commit messages contain the owner's requests.

## 3. `schema.json` (required)
```json
{
  "version": 1,
  "notes": "Rules of this site for the editor, plain text, max 4000 chars",
  "site": { "type": "object", "...": "JSON Schema (draft 2020-12) of site.json" },
  "page": { "type": "object", "...": "JSON Schema (draft 2020-12) of every pages/<slug>.json" }
}
```
Rules the editor enforces (it refuses to edit a site whose schema breaks them):
- `version` is `1`; `site` and `page` are JSON Schemas with `"type": "object"`.
- The page schema has properties **`slug`** and **`title`** and lists both in `required`.
- Whole file ≤ 200 000 bytes (it is sent to the AI model with every edit — smaller is cheaper and better).

How to write it well:
- **Define the schema in code and generate the file** — never hand-edit `schema.json`. The demo defines zod
  schemas (`packages/site-schema/src/index.ts`), renders them with `z.toJSONSchema(…, { io: "input" })` and writes
  the file with `apps/site/scripts/schema.ts` (`pnpm schema`). CI runs `pnpm schema:check` and fails when the
  committed file is out of date.
- Use the **same schema in the site build** to validate content and fail the build on invalid content
  (demo: `apps/site/lib/content.ts`). This is the second safety gate behind the editor.
- Only use rules that survive into JSON Schema: types, `min`/`max`, lengths, enums, literals, **regex patterns**.
  Custom code checks (zod `.refine`, `.transform`) are invisible to the editor — express them as regexes.
- Strict objects (`additionalProperties: false`, zod `z.strictObject`) so typos are rejected.
- Sections/blocks as a **list discriminated by `"type"`** (zod `z.discriminatedUnion("type", […])`): the editor
  then reports errors only for the block kind that was written. Each block kind has a literal `type`.
- **Describe** fields whose meaning is not obvious (`.describe("Price in integer euro cents: 6,50 € is 650")`):
  descriptions reach the AI as part of the schema.
- Money as integer cents (ADR-005). Dates/times as strings with a regex (`^\d{4}-\d{2}-\d{2}$`, `^\d{2}:\d{2}$`).
- Limits on lists and text lengths, so a page cannot grow without bound.
- `notes`: short, site-specific rules (units, which language the site is in, what content lives where, what must
  not be changed). Write them for an AI that sees this site for the first time.

What the editor can then do: change any value the schema allows, add/remove/reorder blocks and list items,
create pages from the blocks the page schema allows, delete pages (not `index`), change `site.json`
(except `site.id` if present). What it cannot do (by design): new kinds of blocks, design or layout changes,
new images (uploads come later). Those are developer work: add the component + schema, regenerate `schema.json`.

## 4. Branches and deploy (required)
- Two branches: a **test** branch (demo `demo/dev`) and a **live** branch (demo `demo/main`). Each is built and
  deployed on every push: test → hidden test site (`noindex` everywhere), live → the real site.
- The deploy job must be named exactly **`Deploy site`** (GitHub Actions job `name:`) and must finish only after
  the site is deployed and answers (smoke test). The editor reads this check run to show the owner
  "Pripravljam testno stran …" → "Urejeno" (TASK-012). Example: `.github/workflows/site-demo.yml`.
- The test site build sets a preview flag that adds `noindex` to every page (demo: `SITE_PREVIEW=1`).
- Undo works only on publish commits made by the editor (`Objava urejevalnika: …`); developer commits on the live
  branch are never reverted by the editor.

## 5. The `/uredi` page (required)
Follow `docs/template/uredi-page.md` (ADR-011): a page at `/uredi` that contains only
`<script src="https://uredi.inzenirji.si/embed.js" data-site="<siteId>" defer></script>`, no header/footer,
hidden from search engines (meta + `X-Robots-Tag` + `Disallow: /uredi` + not in sitemap). The site id is the one
registered in the editor database.

## 6. Registering the site in the editor (operator, not the site developer)
1. GitHub access to the repo (dev: fine-grained token; production: the Inženirji.si GitHub App installed on it).
2. D1 rows: `sites` (id, name, origin = the site's https origin), `site_users` (owner e-mails),
   `site_repos` (owner, repo, test/live branch, content root, test/live URL). See `docs/runbooks/add-site-user.md`.

## 7. Checklist before handing a site over
- [ ] `schema.json` generated from code, `schema:check` in CI, version 1, page requires `slug` + `title`.
- [ ] Build validates content with the same schema and fails on invalid content.
- [ ] `index.json` exists; every page's `slug` equals its file name; no page named `uredi`.
- [ ] `notes` explain units and site-specific rules.
- [ ] Test and live branches deploy on push with a job named `Deploy site` that ends after a smoke test.
- [ ] `/uredi` page per ADR-011; test site `noindex` everywhere.
- [ ] Repo private; site registered in D1; owner can log in and a test edit shows "Urejeno" on the test site.
