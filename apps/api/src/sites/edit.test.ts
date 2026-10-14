import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallModel, ModelResponse } from "../agent/claude.ts";
import { ModelError } from "../agent/claude.ts";
import { createApp } from "../app.ts";
import { createGitHubStore } from "../content/github.ts";
import type { FakeGitHub } from "../testing/fake-github.ts";
import { contentFixture, demoMenu, ROOT, T0 } from "../testing/fixtures.ts";
import { EDIT_LIMIT_PER_HOUR, MAX_MESSAGE_CHARS } from "./routes.ts";

const usage = { input: 10_000, output: 1_000, cacheRead: 0, cacheWrite: 0 };
const newMenu = structuredClone(demoMenu);
(newMenu.blocks[0] as { groups: Array<{ items: Array<{ priceCents: number }> }> }).groups[0]!
  .items[0]!.priceCents = 650;

/** Model that writes the new menu once, then answers. */
function priceChangingModel(): CallModel {
  let step = 0;
  return async (): Promise<ModelResponse> => {
    step++;
    if (step % 2 === 1) {
      return {
        content: [{ type: "tool_use", id: `w${step}`, name: "write_page", input: { page: newMenu } }],
        stopReason: "tool_use",
        usage,
      };
    }
    return { content: [{ type: "text", text: "Cena je zdaj 6,50 €." }], stopReason: "end_turn", usage };
  };
}

async function setup(opts: { model?: CallModel | null } = {}) {
  const f = await contentFixture();
  const callModel = opts.model === undefined ? vi.fn(priceChangingModel()) : opts.model;
  const app = createApp({
    version: "test",
    sites: {
      db: f.db,
      now: () => T0,
      storeFor: (repo) => createGitHubStore(repo, f.gh.token, f.gh.fetch),
      ...(callModel ? { agent: { callModel, model: "claude-sonnet-5-5", usdToEur: 0.92, margin: 1 } } : {}),
    },
  });
  const edit = (body: unknown, token: string = f.session) =>
    app.request("/api/sites/demo/edit", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const log = () =>
    f.db.raw
      .prepare(
        "SELECT kind, request, reply, commit_sha, cost_micros, price_cents, input_tokens FROM change_log ORDER BY id",
      )
      .all() as Array<Record<string, unknown>>;
  return { ...f, edit, log, callModel };
}

afterEach(() => vi.restoreAllMocks());

describe("POST /api/sites/:siteId/edit", () => {
  it("commits the change to the test branch, logs cost, and answers with reply, preview and price", async () => {
    const t = await setup();
    const res = await t.edit({ message: "Bučna juha naj stane 6,50 €" });
    expect(res.status).toBe(200);
    // 2 model calls × (10 000 × 2 + 1 000 × 10) micro-USD × 0.92 = 55 200 micro-euros → 6 cents
    expect(await res.json()).toEqual({
      reply: "Cena je zdaj 6,50 €.",
      changed: true,
      commitSha: t.gh.refs.get("demo/dev"), // the widget waits for this commit's test-site build
      files: ["pages/meni.json"],
      escalated: false,
      previewUrl: "https://demo-dev.inzenirji.si",
      costMicros: 55_200,
      priceCents: 6,
    });
    const dev = t.gh.commits.get(t.gh.refs.get("demo/dev") as string);
    expect(dev?.message).toBe("Urejevalnik: Bučna juha naj stane 6,50 €");
    expect(JSON.parse(t.gh.filesAt("demo/dev")[`${ROOT}/pages/meni.json`] as string)).toEqual(newMenu);
    expect(t.gh.filesAt("demo/main")[`${ROOT}/pages/meni.json`]).toBe(JSON.stringify(demoMenu)); // live untouched
    expect(t.log()).toEqual([
      {
        kind: "edit",
        request: "Bučna juha naj stane 6,50 €",
        reply: "Cena je zdaj 6,50 €.",
        commit_sha: t.gh.refs.get("demo/dev"),
        cost_micros: 55_200,
        price_cents: 6,
        input_tokens: 20_000,
      },
    ]);
  });

  it("passes earlier edits of the site to the model as history", async () => {
    const t = await setup();
    await t.edit({ message: "Prva sprememba" });
    await t.edit({ message: "Druga sprememba" });
    const calls = (t.callModel as ReturnType<typeof vi.fn>).mock.calls;
    const secondEditFirstCall = calls.at(-2)![0] as { messages: Array<{ content: string }> };
    const lastFirstMessage = secondEditFirstCall.messages[0]!.content;
    expect(lastFirstMessage).toContain('"Prva sprememba" → Cena je zdaj 6,50 €.');
  });

  it("an answer without changes commits nothing but is still logged with its cost", async () => {
    const model: CallModel = async () => ({
      content: [{ type: "text", text: "Katero ceno mislite?" }],
      stopReason: "end_turn",
      usage,
    });
    const t = await setup({ model });
    const before = t.gh.refs.get("demo/dev");
    const body = await (await t.edit({ message: "spremeni ceno" })).json();
    expect(body).toMatchObject({
      changed: false,
      commitSha: null,
      files: [],
      reply: "Katero ceno mislite?",
      costMicros: 27_600,
    });
    expect(t.gh.refs.get("demo/dev")).toBe(before);
    expect(t.log()).toHaveLength(1);
  });

  it("503 without an agent (no API key)", async () => {
    const t = await setup({ model: null });
    const res = await t.edit({ message: "x" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "agent_unavailable" });
  });

  it.each([
    ["not json", "nope"],
    ["missing message", {}],
    ["empty", { message: "   " }],
    ["too long", { message: "a".repeat(MAX_MESSAGE_CHARS + 1) }],
    ["not a string", { message: 5 }],
  ])("400 for %s", async (_name, body) => {
    const t = await setup();
    expect((await t.edit(body)).status).toBe(400);
    expect(t.log()).toEqual([]);
  });

  it(`accepts exactly ${MAX_MESSAGE_CHARS} characters`, async () => {
    const t = await setup();
    expect((await t.edit({ message: "a".repeat(MAX_MESSAGE_CHARS) })).status).toBe(200);
  });

  it(`allows ${EDIT_LIMIT_PER_HOUR} edits per hour per site, then 429`, async () => {
    const model: CallModel = async () => ({
      content: [{ type: "text", text: "Ok." }],
      stopReason: "end_turn",
      usage,
    });
    const t = await setup({ model });
    for (let i = 0; i < EDIT_LIMIT_PER_HOUR; i++)
      expect((await t.edit({ message: `m${i}` })).status).toBe(200);
    const res = await t.edit({ message: "še ena" });
    expect(res.status).toBe(429);
    expect(t.log()).toHaveLength(EDIT_LIMIT_PER_HOUR);
  });

  it("502 when the model API fails, without logging the message content", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));
    const model: CallModel = async () => {
      throw new ModelError(529, "Anthropic API 529 overloaded_error");
    };
    const t = await setup({ model });
    const res = await t.edit({ message: "skrivnost 123" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "agent_unavailable" });
    expect(errors.join(" ")).not.toContain("skrivnost");
  });

  it("409 when the test site changed during the edit; the cost is still logged", async () => {
    const holder: { gh: FakeGitHub | null } = { gh: null };
    let step = 0;
    const model: CallModel = async () => {
      step++;
      if (step === 1 && holder.gh) {
        // someone else commits to the test branch while the model is working
        const head = holder.gh.refs.get("demo/dev") as string;
        holder.gh.refs.set("demo/dev", holder.gh.addCommit(holder.gh.filesAt(head), [head], "other"));
      }
      return step === 1
        ? {
            content: [{ type: "tool_use", id: "w", name: "write_page", input: { page: newMenu } }],
            stopReason: "tool_use",
            usage,
          }
        : { content: [{ type: "text", text: "Ok." }], stopReason: "end_turn", usage };
    };
    const t = await setup({ model });
    holder.gh = t.gh;
    const res = await t.edit({ message: "6,50" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict" });
    expect(t.log()).toMatchObject([{ kind: "edit", commit_sha: null, cost_micros: 55_200 }]);
  });

  it("refuses a session of another site", async () => {
    const t = await setup();
    expect((await t.edit({ message: "x" }, t.otherSession)).status).toBe(403);
    expect(t.callModel).not.toHaveBeenCalled();
  });
});
