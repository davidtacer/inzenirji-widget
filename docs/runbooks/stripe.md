# Runbook — Stripe for credit top-ups (TASK-009, ADR-014)

Seller: David Tacer s.p. Packages 10 / 25 / 50 € (VAT 22 % included). Credit is added only by the signed webhook.
Code: `apps/api/src/billing/` (credit ledger, Stripe Checkout, webhook), widget `Editor.tsx` (credit, packages).

## Test mode first (owner)
1. https://dashboard.stripe.com → account for **David Tacer s.p.** (business details, IBAN for payouts; Settings →
   Business → Public details: name shown on receipts, support e-mail `hello@inzenirji.si`).
2. Switch to **Test mode** (toggle top right). Developers → API keys → copy the **Secret key** `sk_test_…`.
3. Developers → Webhooks → **Add endpoint**:
   - URL: `https://uredi-dev.inzenirji.si/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   - After saving: **Signing secret** `whsec_…` (Reveal).
4. Cloudflare → Workers & Pages → `inzenirji-editor-dev` → Settings → Variables and Secrets, type **Secret**:
   `STRIPE_SECRET_KEY` = `sk_test_…`, `STRIPE_WEBHOOK_SECRET` = `whsec_…`.
5. Settings → Payments → Payment methods: cards (+ Apple Pay / Google Pay) are enough to start.
6. Test: demo editor → "Dodaj dobroimetje" → 10 € → card `4242 4242 4242 4242`, any future date, any CVC →
   the tab shows "Plačilo je uspelo" → back in the editor the credit rises by 10 € within seconds.
   Stripe → Webhooks → endpoint → the delivery shows 200 `{"received":true,"credited":true}`.

## Going live (owner, later)
Same steps in **live mode** with `sk_live_…` and a live webhook endpoint (production editor URL). Before that,
confirm with the accountant (not legal/tax advice from the agent):
- invoice content for prepaid credit (Stripe creates an invoice per payment: `invoice_creation`); seller data,
  VAT ID and numbering in Stripe → Settings → Invoices;
- VAT on prepayments (credited when paid) and whether OSS applies to EU consumers abroad;
- **fiscal verification (davčno potrjevanje računov)** for card payments.

## Ledger and checks
- D1 `credit_ledger`: grant (2 € once per site), topup (+, net/VAT split, Stripe session id, unique), charge (−,
  change_log id), adjust (manual corrections: insert with a note in `ref`).
- Balance of a site: `SELECT SUM(amount_cents) FROM credit_ledger WHERE site_id = '…'`.
- Revenue for a month: `SELECT SUM(net_cents), SUM(vat_cents) FROM credit_ledger WHERE kind = 'topup' AND
  created_at BETWEEN …`.
- A refund in Stripe does not change credit automatically: add an `adjust` row with the negative amount.
