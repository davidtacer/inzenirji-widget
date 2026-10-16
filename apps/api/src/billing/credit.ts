import type { Db } from "../db.ts";

/**
 * Prepaid credit per site (TASK-009, ADR-014). All amounts are integer euro cents including VAT.
 * Balance = sum of the ledger; the starting credit is granted lazily and exactly once (unique index).
 */
export const STARTING_CREDIT_CENTS = 200;
/** Estimate for a site without history (a typical small edit at ×3 incl. VAT). */
export const DEFAULT_ESTIMATE_CENTS = 20;
/** Top-up packages (gross, VAT included). */
export const PACKAGES_CENTS = [1000, 2500, 5000] as const;

export async function ensureStartingCredit(db: Db, siteId: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credit_ledger (site_id, kind, amount_cents, created_at) VALUES (?1, 'grant', ?2, ?3)
       ON CONFLICT DO NOTHING`,
    )
    .bind(siteId, STARTING_CREDIT_CENTS, now)
    .run();
}

export async function balanceCents(db: Db, siteId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS balance FROM credit_ledger WHERE site_id = ?1")
    .bind(siteId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

/** Expected price of the next edit: average of the site's last 10 charged edits, rounded up. */
export async function estimateCents(db: Db, siteId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT AVG(price_cents) AS avg, COUNT(*) AS n FROM (
         SELECT price_cents FROM change_log WHERE site_id = ?1 AND kind = 'edit' AND price_cents > 0
         ORDER BY id DESC LIMIT 10)`,
    )
    .bind(siteId)
    .first<{ avg: number | null; n: number }>();
  return row?.n ? Math.max(1, Math.ceil(row.avg ?? 0)) : DEFAULT_ESTIMATE_CENTS;
}

export async function chargeEdit(
  db: Db,
  e: { siteId: string; email: string; priceCents: number; ref: string | null; now: number },
): Promise<void> {
  if (e.priceCents <= 0) return;
  await db
    .prepare(
      `INSERT INTO credit_ledger (site_id, kind, amount_cents, ref, email, created_at)
       VALUES (?1, 'charge', ?2, ?3, ?4, ?5)`,
    )
    .bind(e.siteId, -e.priceCents, e.ref, e.email, e.now)
    .run();
}

/** Splits a gross amount into net + VAT (VAT rounded to the cent, net = gross − VAT). */
export function splitVat(grossCents: number, vatRate: number): { net: number; vat: number } {
  const net = Math.round(grossCents / (1 + vatRate));
  return { net, vat: grossCents - net };
}

/** Credits a paid Stripe Checkout session once. Returns false when it was already credited. */
export async function creditTopUp(
  db: Db,
  t: {
    siteId: string;
    sessionId: string;
    grossCents: number;
    vatRate: number;
    email: string | null;
    now: number;
  },
): Promise<boolean> {
  const { net, vat } = splitVat(t.grossCents, t.vatRate);
  const res = (await db
    .prepare(
      `INSERT INTO credit_ledger (site_id, kind, amount_cents, net_cents, vat_cents, ref, email, created_at)
       VALUES (?1, 'topup', ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT DO NOTHING`,
    )
    .bind(t.siteId, t.grossCents, net, vat, t.sessionId, t.email, t.now)
    .run()) as { meta?: { changes?: number }; changes?: number | bigint };
  const changes = res.meta?.changes ?? res.changes ?? 0;
  return Number(changes) > 0;
}
