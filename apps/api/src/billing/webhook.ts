import type { ErrorResponse } from "@inzenirji/shared";
import { Hono } from "hono";
import type { Db } from "../db.ts";
import { creditTopUp } from "./credit.ts";
import { verifyWebhook } from "./stripe.ts";

/**
 * POST /api/stripe/webhook (TASK-009): the only way credit is added. Stripe signs every delivery; unsigned,
 * changed or replayed bodies are refused. A paid Checkout session is credited once (unique session id).
 */
export function stripeWebhookRoutes(deps: {
  db: Db;
  now: () => number;
  webhookSecret: string;
  vatRate: number;
}) {
  const app = new Hono();
  app.post("/webhook", async (c) => {
    const raw = await c.req.text();
    const event = await verifyWebhook(
      raw,
      c.req.header("stripe-signature") ?? null,
      deps.webhookSecret,
      deps.now(),
    );
    if (!event) return c.json<ErrorResponse>({ error: "invalid_signature" }, 400);
    const credited = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
    if (!credited.has(event.type)) return c.json({ received: true });
    const s = event.data.object as {
      id?: string;
      mode?: string;
      payment_status?: string;
      currency?: string;
      amount_total?: number;
      metadata?: { site_id?: string; email?: string };
    };
    if (s.mode !== "payment" || s.payment_status !== "paid" || s.currency !== "eur")
      return c.json({ received: true });
    const siteId = s.metadata?.site_id;
    const amount = s.amount_total;
    if (!s.id || !siteId || !Number.isInteger(amount) || (amount as number) <= 0) {
      console.error("[stripe] paid session without site or amount:", s.id ?? "?");
      return c.json({ received: true });
    }
    const site = await deps.db.prepare("SELECT id FROM sites WHERE id = ?1").bind(siteId).first();
    if (!site) {
      console.error("[stripe] paid session for unknown site:", s.id);
      return c.json({ received: true });
    }
    const added = await creditTopUp(deps.db, {
      siteId,
      sessionId: s.id,
      grossCents: amount as number,
      vatRate: deps.vatRate,
      email: s.metadata?.email ?? null,
      now: deps.now(),
    });
    return c.json({ received: true, credited: added });
  });
  return app;
}
