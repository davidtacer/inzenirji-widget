# Product spec — conversational site editor

Source: owner's technical plan "Urejevalnik s pogovorom — tehnični načrt" (2026-10-13, Inženirji.si project).
Status of every item: **Planned** unless a technical doc says otherwise.

## Users
- **Site owner (client):** small business owner (restaurant, salon, physio …). Not technical.
  Edits their own site by writing messages, mostly on a phone.
- **Operator (Inženirji.si):** sets up the site, watches costs, handles level-2 escalations.

## The `/uredi` page on client sites
Not indexed (noindex meta + `X-Robots-Tag`, `Disallow: /uredi` in robots.txt, not in the sitemap, never linked)
and without header/footer so the editor fills the screen. Boilerplate: `docs/template/uredi-page.md`.

## Core flow (one change)
1. Client opens `their-site.si/uredi` and signs in with a magic link sent by e-mail.
2. Client writes a change, optionally attaches images. API checks the credit balance.
3. API reads `content/site.json`, the page list and the block schema from the client repo (GitHub API)
   and sends them with the template's editing rules to Claude (prompt caching on rules + schema).
4. Claude edits JSON through the tools in "Agent tools" below. Every write is schema-validated.
5. API commits all changes as one commit on `dev`, message in plain Slovenian.
6. Hosting builds the hidden test site `dev.their-site.si`; a webhook reports success.
7. API screenshots the changed page (desktop + phone) and shows it to the client (later: to Claude too).
8. Client sees screenshot, test-site link and exact price; writes a correction or clicks **Objavi v živo**.
9. Publish = merge `dev` into `main`; hosting builds the live site; credit is reduced.
10. **Razveljavi** = revert commit on `main`; site is back within seconds.

The client does three things: write, look, confirm.

## Two levels
| | Level 1 — content (default) | Level 2 — structure (later) |
|---|---|---|
| Share of changes (estimate) | ~90 % | ~10 % |
| Examples | price, text, image, hours, notice, new page from existing blocks, translation, SEO | new block type, form with logic, integration |
| How | Messages API + our tools over JSON | Managed Agents sandbox: clone, build, browser |
| Customer price | 0,02–0,10 € typical | upper limit shown before start |

The API classifies each message; if it cannot be done with existing blocks, the agent calls
`escalate` and the client is offered level 2 (with a price ceiling) or hand-off to us.

## Agent tools (level 1)
| Tool | Does | Limits |
|---|---|---|
| `list_pages` | pages with titles and blocks | read-only |
| `read_page(slug)` | one page JSON | read-only |
| `read_site` | name, contact, hours, navigation, languages | read-only |
| `list_blocks` | block catalogue with schema and example | read-only |
| `update_page(slug, patch)` | JSON Patch on a page | schema-validated before write |
| `create_page(slug, blocks)` | new page from existing blocks | safe slug, max N pages |
| `delete_page(slug)` | remove a page | not the home page; explicit client confirmation |
| `update_site(patch)` | contact, hours, navigation | schema-validated |
| `use_upload(id, alt)` | use an image the client attached | only uploads from this conversation; alt required |
| `translate(lang)` | translate content | only listed languages |
| `preview` | commit to `dev`, wait for build, return screenshot | max 3 rounds per message |
| `escalate(reason)` | needs level 2 or a human | offers the client options and price |

## Billing rules (decided 2026-10-13)
- Prepaid credit (Stripe). Starting credit at hand-over: **2 €**.
- Every processed request is charged, published or not. Price = measured AI usage + margin, rounded up to the cent.
- The client sees an **estimate before sending** and the exact price with the screenshot.
- Limits: max price per message, daily limit per site, stop at zero credit, max agent steps.
- Margin: decided after phase 1 measurements.
- Public communication: prices in euros ("0,02–0,10 €"), "brez skritih stroškov".

## Open product questions (owner)
- Hosting: Cloudflare Pages or own server (Hetzner) — ADR-006.
- Public price range: new page / translation is estimated at 0,10–0,20 €, above "0,02–0,10 €".
- Where the content schema lives (template repo vs. shared package) — ADR-007.

## Phases
0. Site template (separate repo). 1. Editor MVP, level 1, no payments. 2. Screenshots, images, translations.
3. Payments. 4. Level 2.
