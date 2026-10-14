# Billing — prepaid credit (TASK-009, ADR-014)

Status: **Live on dev in Stripe test mode** (owner-tested 2026-10-14). Needs Worker secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` for top-ups
(without them editing still works on the credit; `/checkout` answers `503 payments_unavailable`).

- Price of an edit (`agent/pricing.ts`): ⌈cost µ€ × `PRICE_MARGIN` (3) × (1 + `VAT_RATE` 0.22) / 10 000⌉ cents.
  Example: 55 200 µ€ → 21 cents.
- `billing/credit.ts`: ledger in cents incl. VAT; starting credit 200 cents granted once per site (unique partial
  index, inserted on first `/status` or `/edit`); estimate = average price of the site's last 10 charged edits
  (default 20 cents); `chargeEdit` after every processed message (also without a change; not when the AI call
  failed); `creditTopUp` idempotent per Stripe session (unique index), net/VAT split.
- `/edit`: `402 insufficient_credit` when balance < estimate (before GitHub or the model is touched); response
  adds `balanceCents`. `/status` adds `balanceCents`, `estimateCents`, `packagesCents` (empty without Stripe).
- `POST /api/sites/:id/checkout {amountCents ∈ 1000|2500|5000}` → Stripe Checkout session (VAT-inclusive price,
  `invoice_creation`, tax id + billing address, metadata `site_id`) → `{url}`; success/cancel return to
  `<editor origin>/placilo.html?status=ok|cancel` (static page, `apps/widget/public`).
- `POST /api/stripe/webhook` (`billing/webhook.ts`): verifies `Stripe-Signature` (HMAC-SHA256, 5 min tolerance,
  several `v1`), credits `checkout.session.completed` / `async_payment_succeeded` when paid, EUR, known site.
- Widget: credit in the status card (red when below the estimate), "Dodaj dobroimetje" → packages; the Stripe tab
  is opened inside the click (pop-up blockers) and then navigated; on focus the status refreshes (new credit);
  estimate + credit under the composer; 402 opens the packages.
- Owner setup: `docs/runbooks/stripe.md`.
