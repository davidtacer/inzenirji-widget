import { describe, expect, it, vi } from "vitest";
import type { CallModel, ModelRequest, ModelResponse } from "../agent/claude.ts";
import { createApp } from "../app.ts";
import { createGitHubStore } from "../content/github.ts";
import { contentFixture, demoMenu, T0 } from "../testing/fixtures.ts";
import { DEMO_RULES, type DemoConfig, STARTS_PER_IP_DAY_NO_CAPTCHA } from "./routes.ts";
import { applyChanges, EMAIL_EDITS, FREE_EDITS, SANDBOX_TTL_MS, templateLoader } from "./sandbox.ts";

const usage = { input: 10_000, output: 1_000, cacheRead: 0, cacheWrite: 0 };
const CRM_TOKEN = "C".repeat(43);

function menuWithPrice(cents: number) {
  const m = structuredClone(demoMenu);
  (m.blocks[0] as { groups: Array<{ items: Array<{ priceCents: number }> }> }).groups[0]!
    .items[0]!.priceCents = cents;
  return m;
}

/** Model that writes the menu with a new price (odd calls), then answers (even calls). */
function priceModel(cents = 650): CallModel {
  let step = 0;
  return async (): Promise<ModelResponse> => {
    step++;
    if (step % 2 === 1) {
      return {
        content: [
          { type: "tool_use", id: `w${step}`, name: "write_page", input: { page: menuWithPrice(cents) } },
        ],
        stopReason: "tool_use",
        usage,
      };
    }
    return { content: [{ type: "text", text: "Cena je zdaj 6,50 €." }], stopReason: "end_turn", usage };
  };
}

async function setup(opts: { demo?: Partial<DemoConfig>; now?: () => number } = {}) {
  const f = await contentFixture();
  let clock = T0;
  const now = opts.now ?? (() => clock);
  const callModel = vi.fn(priceModel());
  const background: Promise<unknown>[] = [];
  const crmCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("turnstile")) {
      const token = (init!.body as FormData).get("response");
      return Response.json({ success: token === "good" });
    }
    crmCalls.push({ url, init });
    return Response.json({ ok: true });
  });
  const sites = {
    db: f.db,
    now,
    storeFor: (repo: Parameters<typeof createGitHubStore>[0]) =>
      createGitHubStore(repo, f.gh.token, f.gh.fetch),
  };
  const demo: DemoConfig = {
    callModel,
    model: "claude-haiku-5-5",
    usdToEur: 1,
    dailyCapMicros: 20_000_000,
    turnstile: null,
    crm: null,
    fetchImpl,
    ...opts.demo,
  };
  const app = createApp({
    version: "test",
    sites,
    demo: {
      db: f.db,
      now,
      demo,
      template: templateLoader(f.db, sites.storeFor, "demo", now),
      background: (w) => background.push(w),
    },
  });
  const call = (path: string, body?: unknown, token?: string, ip = "1.2.3.4") =>
    app.request(`/api/demo/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const start = async (body: unknown = {}, ip?: string) => {
    const res = await call("start", body, undefined, ip);
    return { res, json: (await res.json()) as Record<string, unknown> & { token: string } };
  };
  const edit = (token: string, message = "Bučna juha naj stane 6,50 €") => call("edit", { message }, token);
  const settle = async () => {
    await Promise.all(background.splice(0));
  };
  return {
    f,
    app,
    call,
    start,
    edit,
    callModel,
    fetchImpl,
    crmCalls,
    settle,
    tick: (ms: number) => (clock += ms),
  };
}

const priceOf = (content: unknown) =>
  (
    (content as { pages: Record<string, typeof demoMenu> }).pages.meni!.blocks[0] as {
      groups: Array<{ items: Array<{ priceCents: number }> }>;
    }
  ).groups[0]!.items[0]!.priceCents;

describe("public demo (TASK-016)", () => {
  it("config tells the widget the limits and that there is no captcha", async () => {
    const t = await setup();
    const res = await t.call("config");
    expect(await res.json()).toEqual({
      turnstileSiteKey: null,
      freeEdits: FREE_EDITS,
      emailEdits: EMAIL_EDITS,
    });
  });

  it("starts a sandbox with the live demo content and edits it without touching git", async () => {
    const t = await setup();
    const { res, json } = await t.start();
    expect(res.status).toBe(200);
    expect(json.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(priceOf(json.content)).toBe(550);
    expect(json).toMatchObject({ edits: 0, limit: FREE_EDITS, emailGiven: false });
    const commitsBefore = t.f.gh.commits.size;

    const edited = await t.edit(json.token);
    expect(edited.status).toBe(200);
    const body = (await edited.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      reply: "Cena je zdaj 6,50 €.",
      changed: true,
      pages: ["meni"],
      edits: 1,
      limit: FREE_EDITS,
    });
    expect(priceOf(body.content)).toBe(650);
    expect(t.f.gh.commits.size).toBe(commitsBefore); // nothing committed

    const state = (await (await t.call("state", undefined, json.token)).json()) as Record<string, unknown>;
    expect(priceOf(state.content)).toBe(650);
    const log = t.f.db.raw.prepare("SELECT request, changed, model, cost_micros FROM demo_edits").all();
    expect(log).toEqual([
      { request: "Bučna juha naj stane 6,50 €", changed: 1, model: "claude-haiku-5-5", cost_micros: 3000 },
    ]);
  });

  it("sends the demo moderation rules to the model", async () => {
    const t = await setup();
    const { json } = await t.start();
    await t.edit(json.token);
    const req = t.callModel.mock.calls[0]![0] as ModelRequest;
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.system).toContain(DEMO_RULES);
  });

  it("asks for an e-mail after the free edits, then allows more and sends the lead to the CRM", async () => {
    const t = await setup({ demo: { crm: { url: "https://crm.test/api/leads/demo", token: CRM_TOKEN } } });
    const { json } = await t.start();
    for (let i = 0; i < FREE_EDITS; i++) expect((await t.edit(json.token)).status).toBe(200);
    const blocked = await t.edit(json.token);
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toEqual({ error: "email_required" });

    expect((await t.call("email", { email: "ni-email" }, json.token)).status).toBe(400);
    const ok = await t.call("email", { email: " Ana@Primer.si ", website: "primer.si" }, json.token);
    expect(await ok.json()).toMatchObject({
      emailGiven: true,
      limit: FREE_EDITS + EMAIL_EDITS,
      edits: FREE_EDITS,
    });
    await t.settle();
    expect(t.crmCalls).toHaveLength(1);
    const call = t.crmCalls[0]!;
    expect(call.url).toBe("https://crm.test/api/leads/demo");
    expect((call.init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${CRM_TOKEN}`);
    const lead = JSON.parse(String(call.init?.body));
    expect(lead).toMatchObject({ email: "ana@primer.si", website: "primer.si" });
    expect(lead.edits).toHaveLength(FREE_EDITS);
    expect(lead.edits[0]).toMatchObject({ request: "Bučna juha naj stane 6,50 €", changed: true });
    // Accepted leads are not sent again.
    await t.call("email", { email: "ana@primer.si" }, json.token);
    await t.settle();
    expect(t.crmCalls).toHaveLength(1);

    for (let i = 0; i < EMAIL_EDITS; i++) expect((await t.edit(json.token)).status).toBe(200);
    const done = await t.edit(json.token);
    expect(done.status).toBe(402);
    expect(await done.json()).toEqual({ error: "demo_limit" });
  });

  it("keeps a lead pending when the CRM is not configured and sends it later", async () => {
    const t = await setup();
    const { json } = await t.start();
    await t.call("email", { email: "ana@primer.si" }, json.token);
    await t.settle();
    expect(t.crmCalls).toHaveLength(0);
    const row = t.f.db.raw.prepare("SELECT email, lead_sent_at FROM demo_sandboxes").get();
    expect(row).toEqual({ email: "ana@primer.si", lead_sent_at: null });
  });

  it("checks Turnstile when configured", async () => {
    const t = await setup({ demo: { turnstile: { siteKey: "site", secretKey: "secret" } } });
    expect(await (await t.call("config")).json()).toMatchObject({ turnstileSiteKey: "site" });
    expect((await t.start({})).res.status).toBe(403);
    expect((await t.start({ turnstileToken: "bad" })).res.status).toBe(403);
    expect((await t.start({ turnstileToken: "good" })).res.status).toBe(200);
  });

  it("limits new sandboxes per IP", async () => {
    const t = await setup();
    for (let i = 0; i < STARTS_PER_IP_DAY_NO_CAPTCHA; i++) expect((await t.start()).res.status).toBe(200);
    expect((await t.start()).res.status).toBe(429);
    expect((await t.start({}, "9.9.9.9")).res.status).toBe(200);
  });

  it("pauses the demo when the daily cost cap is reached", async () => {
    const t = await setup({ demo: { dailyCapMicros: 3000 } });
    const { json } = await t.start();
    expect((await t.edit(json.token)).status).toBe(200);
    const paused = await t.edit(json.token);
    expect(paused.status).toBe(503);
    expect(await paused.json()).toEqual({ error: "demo_paused" });
    t.tick(24 * 60 * 60_000);
    // A new day: the old sandbox expired, a new one may edit again.
    expect((await t.edit(json.token)).status).toBe(401);
    const again = await t.start();
    expect((await t.edit(again.json.token)).status).toBe(200);
  });

  it("expires sandboxes after 24 hours and clears their content", async () => {
    const t = await setup();
    const { json } = await t.start();
    t.tick(SANDBOX_TTL_MS);
    const res = await t.call("state", undefined, json.token);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "sandbox_expired" });
    await t.start({}, "5.5.5.5"); // runs the cleanup
    const rows = t.f.db.raw.prepare("SELECT content FROM demo_sandboxes ORDER BY created_at").all();
    expect(rows[0]).toEqual({ content: null });
  });

  it("resets the content to the template but keeps the count", async () => {
    const t = await setup();
    const { json } = await t.start();
    await t.edit(json.token);
    const res = (await (await t.call("reset", {}, json.token)).json()) as Record<string, unknown>;
    expect(priceOf(res.content)).toBe(550);
    expect(res.edits).toBe(1);
  });

  it("refuses requests without a sandbox and over-long messages", async () => {
    const t = await setup();
    expect((await t.edit("Z".repeat(43))).status).toBe(401);
    const { json } = await t.start();
    expect((await t.edit(json.token, "x".repeat(501))).status).toBe(400);
    expect(t.callModel).not.toHaveBeenCalled();
  });

  it("gives funnel numbers only with the CRM token", async () => {
    const t = await setup({ demo: { crm: { url: "https://crm.test/x", token: CRM_TOKEN } } });
    const a = await t.start();
    await t.start({}, "2.2.2.2");
    await t.edit(a.json.token);
    await t.call("email", { email: "ana@primer.si" }, a.json.token);
    expect((await t.call("stats")).status).toBe(401);
    expect((await t.call("stats", undefined, "Z".repeat(43))).status).toBe(401);
    const stats = await (await t.call("stats", undefined, CRM_TOKEN)).json();
    expect(stats).toMatchObject({ visits: 2, edited: 1, emails: 1, edits: 1, costMicros: 3000 });
  });
});

describe("applyChanges", () => {
  it("updates, deletes and ignores odd paths", () => {
    const content = { site: { name: "A" }, pages: { index: { a: 1 }, meni: { b: 1 } } };
    const next = applyChanges(content, [
      { path: "site.json", content: '{"name":"B"}' },
      { path: "pages/meni.json", content: null },
      { path: "pages/nova.json", content: '{"c":1}' },
      { path: "../x.json", content: "{}" },
    ]);
    expect(next).toEqual({ site: { name: "B" }, pages: { index: { a: 1 }, nova: { c: 1 } } });
    expect(content.pages.meni).toEqual({ b: 1 }); // input untouched
  });
});
