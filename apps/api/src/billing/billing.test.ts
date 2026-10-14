import { describe, expect, it, vi } from "vitest";
import type { CallModel } from "../agent/claude.ts";
import { ModelError } from "../agent/claude.ts";
import { priceCents } from "../agent/pricing.ts";
import { createApp } from "../app.ts";
import { createGitHubStore } from "../content/github.ts";
import { contentFixture, DEMO, T0 } from "../testing/fixtures.ts";
import {
  balanceCents,
  creditTopUp,
  ensureStartingCredit,
  estimateCents,
  STARTING_CREDIT_CENTS,
  splitVat,
} from "./credit.ts";
import { createCheckoutSession, StripeError, verifyWebhook } from "./stripe.ts";

const WHSEC = "whsec_test_secret";
const usage = { input: 10_000, output: 1_000, cacheRead: 0, cacheWrite: 0 };
const answer: CallModel = async () => ({
  content: [{ type: "text", text: "Katero ceno mislite?" }],
  stopReason: "end_turn",
  usage,
});

async function sign(body: string, secret = WHSEC, t = Math.floor(T0 / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const paidEvent = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        mode: "payment",
        payment_status: "paid",
        currency: "eur",
        amount_total: 1000,
        metadata: { site_id: "demo", email: "lastnik@example.com" },
        ...over,
      },
    },
  });

async function setup(opts: { model?: CallModel; payments?: boolean; createCheckout?: unknown } = {}) {
  const f = await contentFixture();
  const callModel = vi.fn(opts.model ?? answer);
  const createCheckout = vi.fn(
    (opts.createCheckout as typeof createCheckoutSession) ??
      (async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" })),
  );
  const app = createApp({
    version: "test",
    sites: {
      db: f.db,
      now: () => T0,
      storeFor: (repo) => createGitHubStore(repo, f.gh.token, f.gh.fetch),
      agent: { callModel, model: "claude-sonnet-5-5", usdToEur: 0.92, margin: 3, vatRate: 0.22 },
      ...(opts.payments === false
        ? {}
        : {
            payments: {
              stripe: { secretKey: "sk_test_x", webhookSecret: WHSEC },
              vatRate: 0.22,
              createCheckout,
            },
          }),
    },
  });
  const auth = { Authorization: `Bearer ${f.session}` };
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`https://uredi-dev.inzenirji.si/api/sites/demo/${path}`, {
      method,
      headers: { ...auth, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const webhook = async (body: string, signature?: string | null) =>
    app.request("/api/stripe/webhook", {
      method: "POST",
      headers: signature === null ? {} : { "Stripe-Signature": signature ?? (await sign(body)) },
      body,
    });
  const ledger = () =>
    f.db.raw
      .prepare("SELECT kind, amount_cents, net_cents, vat_cents, ref FROM credit_ledger ORDER BY id")
      .all();
  return { ...f, call, webhook, ledger, callModel, createCheckout };
}

describe("price (ADR-014)", () => {
  it("cost × 3 × 1.22 rounded up to the cent", () => {
    // 2 calls × (10 000 × 2 + 1 000 × 10) micro-USD × 0.92 = 55 200 µ€ → × 3 × 1.22 = 20.2 → 21 cents
    expect(priceCents(55_200, 3, 0.22)).toBe(21);
    expect(priceCents(0, 3, 0.22)).toBe(0);
    expect(priceCents(1, 3, 0.22)).toBe(1); // never free
  });

  it("splits gross top-ups into net + 22 % VAT", () => {
    expect(splitVat(1000, 0.22)).toEqual({ net: 820, vat: 180 });
    expect(splitVat(2500, 0.22)).toEqual({ net: 2049, vat: 451 });
    expect(splitVat(5000, 0.22)).toEqual({ net: 4098, vat: 902 });
  });
});

describe("ledger", () => {
  it("starting credit is granted once", async () => {
    const t = await setup();
    await ensureStartingCredit(t.db, DEMO.id, T0);
    await ensureStartingCredit(t.db, DEMO.id, T0);
    expect(await balanceCents(t.db, DEMO.id)).toBe(STARTING_CREDIT_CENTS);
  });

  it("a Stripe session is credited once, however often it is delivered", async () => {
    const t = await setup();
    const top = { siteId: DEMO.id, sessionId: "cs_1", grossCents: 1000, vatRate: 0.22, email: null, now: T0 };
    expect(await creditTopUp(t.db, top)).toBe(true);
    expect(await creditTopUp(t.db, top)).toBe(false);
    expect(await balanceCents(t.db, DEMO.id)).toBe(1000);
  });
});

describe("edits are prepaid", () => {
  it("every processed message is charged (also without a change), linked to its log entry", async () => {
    const t = await setup();
    const res = await t.call("POST", "edit", { message: "spremeni ceno" });
    const body = (await res.json()) as { priceCents: number; balanceCents: number; changed: boolean };
    expect(body.changed).toBe(false);
    expect(body.priceCents).toBe(11); // 1 call: 27 600 µ€ × 3 × 1.22 = 10.1 → 11
    expect(body.balanceCents).toBe(200 - 11);
    const logId = (t.db.raw.prepare("SELECT id FROM change_log").get() as { id: number }).id;
    expect(t.ledger()).toEqual([
      { kind: "grant", amount_cents: 200, net_cents: null, vat_cents: null, ref: null },
      { kind: "charge", amount_cents: -11, net_cents: null, vat_cents: null, ref: String(logId) },
    ]);
  });

  it("not enough credit for the estimate → 402, the model is not called, nothing charged", async () => {
    const t = await setup();
    await ensureStartingCredit(t.db, DEMO.id, T0);
    t.db.raw
      .prepare(
        "INSERT INTO credit_ledger (site_id, kind, amount_cents, created_at) VALUES ('demo', 'adjust', -185, 0)",
      )
      .run();
    const res = await t.call("POST", "edit", { message: "spremeni ceno" });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "insufficient_credit" });
    expect(t.callModel).not.toHaveBeenCalled();
    expect(await balanceCents(t.db, DEMO.id)).toBe(15);
  });

  it("the estimate follows the site's own recent edits", async () => {
    const t = await setup();
    await t.call("POST", "edit", { message: "a" });
    await t.call("POST", "edit", { message: "b" });
    expect(await estimateCents(t.db, DEMO.id)).toBe(11);
    const status = (await (await t.call("GET", "status")).json()) as Record<string, unknown>;
    expect(status).toMatchObject({
      balanceCents: 200 - 22,
      estimateCents: 11,
      packagesCents: [1000, 2500, 5000],
    });
  });

  it("a failed AI call is not charged", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setup({
      model: async () => {
        throw new ModelError(529, "overloaded");
      },
    });
    expect((await t.call("POST", "edit", { message: "x" })).status).toBe(502);
    expect(await balanceCents(t.db, DEMO.id)).toBe(200);
    vi.restoreAllMocks();
  });
});

describe("POST /checkout", () => {
  it("creates a Stripe Checkout for a package and returns its URL", async () => {
    const t = await setup();
    const res = await t.call("POST", "checkout", { amountCents: 2500 });
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(t.createCheckout).toHaveBeenCalledWith(
      { secretKey: "sk_test_x", webhookSecret: WHSEC },
      {
        siteId: "demo",
        siteName: "Gostilna Pri Lipi",
        email: "lastnik@example.com",
        amountCents: 2500,
        successUrl: "https://uredi-dev.inzenirji.si/placilo.html?status=ok",
        cancelUrl: "https://uredi-dev.inzenirji.si/placilo.html?status=cancel",
      },
    );
  });

  it.each([[999], [1], [-1000], ["1000"], [null]])(
    "refuses amount %j (only the packages)",
    async (amountCents) => {
      const t = await setup();
      const res = await t.call("POST", "checkout", { amountCents });
      expect(res.status).toBe(400);
      expect(t.createCheckout).not.toHaveBeenCalled();
    },
  );

  it("without Stripe configured → 503 payments_unavailable", async () => {
    const t = await setup({ payments: false });
    expect((await t.call("POST", "checkout", { amountCents: 1000 })).status).toBe(503);
  });

  it("Stripe failure → 502 payments_failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setup({
      createCheckout: async () => {
        throw new StripeError(500);
      },
    });
    const res = await t.call("POST", "checkout", { amountCents: 1000 });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "payments_failed" });
    vi.restoreAllMocks();
  });
});

describe("POST /api/stripe/webhook", () => {
  it("credits a paid session once; the balance shows it", async () => {
    const t = await setup();
    const body = paidEvent();
    expect(await (await t.webhook(body)).json()).toEqual({ received: true, credited: true });
    expect(await (await t.webhook(body)).json()).toEqual({ received: true, credited: false }); // redelivery
    expect(t.ledger()).toContainEqual({
      kind: "topup",
      amount_cents: 1000,
      net_cents: 820,
      vat_cents: 180,
      ref: "cs_test_1",
    });
    expect(await balanceCents(t.db, DEMO.id)).toBe(1000); // no grant yet — granted on first status/edit
    const status = (await (await t.call("GET", "status")).json()) as { balanceCents: number };
    expect(status.balanceCents).toBe(1200);
  });

  it.each([
    ["no signature", null],
    ["wrong secret", "wrong"],
    ["changed body", "changed"],
    ["replayed after 5 minutes", "old"],
  ] as const)("refuses %s", async (_case, kind) => {
    const t = await setup();
    const body = paidEvent();
    const signature =
      kind === null
        ? null
        : kind === "wrong"
          ? await sign(body, "whsec_other")
          : kind === "changed"
            ? await sign(paidEvent({ amount_total: 999_999 }))
            : await sign(body, WHSEC, Math.floor(T0 / 1000) - 301);
    const res = await t.webhook(body, signature);
    expect(res.status).toBe(400);
    expect(t.ledger()).toEqual([]);
  });

  it.each([
    ["unpaid", { payment_status: "unpaid" }],
    ["other currency", { currency: "usd" }],
    ["unknown site", { metadata: { site_id: "nobody" } }],
  ])("ignores a %s session", async (_case, over) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setup();
    expect((await t.webhook(paidEvent(over))).status).toBe(200);
    expect(t.ledger()).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("Stripe client", () => {
  it("creates a payment session with VAT-inclusive price, invoice, site in metadata", async () => {
    const f = vi.fn(
      async (_u: string, _i?: RequestInit) =>
        new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/x" }), { status: 200 }),
    );
    const res = await createCheckoutSession(
      { secretKey: "sk_test_x", webhookSecret: WHSEC },
      {
        siteId: "demo",
        siteName: "Gostilna Pri Lipi",
        email: "a@b.si",
        amountCents: 1000,
        successUrl: "https://e/ok",
        cancelUrl: "https://e/no",
      },
      f,
    );
    expect(res).toEqual({ id: "cs_1", url: "https://checkout.stripe.com/x" });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk_test_x");
    const p = new URLSearchParams(String(init?.body));
    expect(p.get("mode")).toBe("payment");
    expect(p.get("line_items[0][price_data][unit_amount]")).toBe("1000");
    expect(p.get("line_items[0][price_data][currency]")).toBe("eur");
    expect(p.get("line_items[0][price_data][tax_behavior]")).toBe("inclusive");
    expect(p.get("line_items[0][price_data][product_data][name]")).toBe("Dobroimetje urejevalnika 10,00 €");
    expect(p.get("metadata[site_id]")).toBe("demo");
    expect(p.get("invoice_creation[enabled]")).toBe("true");
    expect(p.get("customer_email")).toBe("a@b.si");
  });

  it("verifyWebhook accepts Stripe's header with several signatures", async () => {
    const body = paidEvent();
    const good = await sign(body);
    const header = `${good},v1=${"0".repeat(64)}`;
    expect(await verifyWebhook(body, header, WHSEC, T0)).toMatchObject({
      type: "checkout.session.completed",
    });
  });
});
