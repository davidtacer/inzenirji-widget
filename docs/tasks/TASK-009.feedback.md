# TASK-009 — feedback (prepaid credit, Stripe)

## Proof (2026-10-14)
- `pnpm lint && pnpm typecheck && pnpm test` green: 442 tests (api 233, widget 96, shared 50, site-schema 42,
  embed 21); build + Worker dry run OK; migration `0003_credit.sql` applied by the test DB like in D1.
- API: price ×3 ×1.22 (55 200 µ€ → 21 c), VAT split of packages (10 € → 8,20 + 1,80); grant once; every processed
  message charged and linked to its change_log row; 402 before model/GitHub when credit < estimate; estimate from
  the site's own edits; failed AI call not charged; checkout only for packages, URLs back to the editor origin,
  503/502 mapping; webhook credits once per session, refuses missing/wrong/changed/old signatures, ignores
  unpaid/other currency/unknown site; Stripe request fields (VAT-inclusive, invoice, metadata).
- Widget: credit + estimate shown, packages, tab opened in the click then sent to Stripe, pop-up blocked, failure
  closes the tab, 402 opens packages, balance from the edit response and refresh on focus, no button without Stripe.
- Real browser (Chromium 390×844): credit card, packages, 402 message, payment tab opened, credit refreshed on
  focus; screenshot reviewed.
- Deliberate breaks: no credit check → 1 test fails; no signature check → 2 fail; no charging → 3 fail.

## Not verified here
- Real Stripe (owner sets up test mode, `docs/runbooks/stripe.md`). Tax/invoice/fiscal questions → accountant.
