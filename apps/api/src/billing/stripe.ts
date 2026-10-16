/**
 * Stripe Checkout for credit top-ups (TASK-009, ADR-014). Only the REST API with fetch (no SDK) and the
 * documented webhook signature (HMAC-SHA256 of "<timestamp>.<body>" with the endpoint secret).
 */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
}

export interface CheckoutRequest {
  siteId: string;
  siteName: string;
  email: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
}

/** Stripe's form encoding (nested keys with brackets). */
function form(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export class StripeError extends Error {
  constructor(readonly status: number) {
    super(`Stripe API ${status}`);
    this.name = "StripeError";
  }
}

export async function createCheckoutSession(
  cfg: StripeConfig,
  req: CheckoutRequest,
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
): Promise<{ id: string; url: string }> {
  const euros = (req.amountCents / 100).toFixed(2).replace(".", ",");
  const res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: form({
      mode: "payment",
      locale: "sl",
      customer_email: req.email,
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": req.amountCents,
      // Prices include VAT (ADR-014).
      "line_items[0][price_data][tax_behavior]": "inclusive",
      "line_items[0][price_data][product_data][name]": `Dobroimetje urejevalnika ${euros} €`,
      "line_items[0][price_data][product_data][description]": `Za spletno stran ${req.siteName}`,
      "invoice_creation[enabled]": true,
      "tax_id_collection[enabled]": true,
      billing_address_collection: "required",
      "metadata[site_id]": req.siteId,
      "metadata[email]": req.email,
      "payment_intent_data[metadata][site_id]": req.siteId,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
    }),
  });
  if (!res.ok) throw new StripeError(res.status);
  const data = (await res.json()) as { id: string; url: string };
  return { id: data.id, url: data.url };
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Constant-time comparison of two hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signature tolerance (Stripe's default: 5 minutes). */
export const WEBHOOK_TOLERANCE_S = 300;

/**
 * Verifies the `Stripe-Signature` header ("t=…,v1=…[,v1=…]") against the raw body. Returns the parsed event or
 * null (wrong secret, changed body, replay older than 5 minutes).
 */
export async function verifyWebhook(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number,
): Promise<{ type: string; data: { object: Record<string, unknown> } } | null> {
  if (!header) return null;
  const parts = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return null;
  if (Math.abs(nowMs / 1000 - Number(t)) > WEBHOOK_TOLERANCE_S) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
  if (!sigs.some((s) => safeEqual(s, expected))) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}
