import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallModel, ContentBlock, ModelRequest, ModelResponse } from "../agent/claude.ts";
import { ModelError } from "../agent/claude.ts";
import { createApp } from "../app.ts";
import { createGitHubStore } from "../content/github.ts";
import type { FakeGitHub } from "../testing/fake-github.ts";
import { contentFixture, demoMenu, demoSchemaText, JPEG, PNG, ROOT, SVG, T0 } from "../testing/fixtures.ts";
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
  const editWithImages = (message: string, images: Array<{ name: string; bytes: Uint8Array }>) => {
    const form = new FormData();
    form.set("message", message);
    for (const img of images) form.append("images", new Blob([img.bytes]), img.name);
    return app.request("/api/sites/demo/edit", {
      method: "POST",
      headers: { Authorization: `Bearer ${f.session}` },
      body: form,
    });
  };
  return { ...f, edit, editWithImages, log, callModel };
}

/** Model that puts the first attached image into a new gallery on the menu page. */
function galleryModel(requests: ModelRequest[]): CallModel {
  return async (req) => {
    requests.push(structuredClone(req));
    if (requests.length === 1) {
      const first = req.messages[0]?.content as ContentBlock[];
      const url = (
        first.find((b) => b.type === "text" && b.text.startsWith("Attached image 1")) as {
          text: string;
        }
      ).text.split(": ")[1] as string;
      const page = structuredClone(demoMenu) as { blocks: unknown[] };
      page.blocks.push({
        type: "gallery",
        heading: "Terasa",
        images: [{ src: url, alt: "Terasa z mizami" }],
      });
      return {
        content: [{ type: "tool_use", id: "w1", name: "write_page", input: { page } }],
        stopReason: "tool_use",
        usage,
      };
    }
    return { content: [{ type: "text", text: "Dodal sem sliko terase." }], stopReason: "end_turn", usage };
  };
}

afterEach(() => vi.restoreAllMocks());

describe("POST /api/sites/:siteId/edit with images (TASK-015)", () => {
  it("the model sees the image and its URL; the used image is committed with the page in one commit", async () => {
    const requests: ModelRequest[] = [];
    const t = await setup({ model: galleryModel(requests) });
    const res = await t.editWithImages("Dodaj sliko terase na meni", [{ name: "Terasa.jpg", bytes: JPEG }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changed: boolean; images: string[]; commitSha: string };
    expect(body.changed).toBe(true);
    expect(body.images).toHaveLength(1);
    const url = body.images[0] as string;
    expect(url).toMatch(/^\/uploads\/\d{4}-\d{2}-terasa-[0-9a-f]{8}\.jpg$/);

    const first = requests[0]?.messages[0]?.content as Array<ContentBlock & { cache_control?: unknown }>;
    const image = first.find((b) => b.type === "image") as Extract<ContentBlock, { type: "image" }>;
    expect(image.source.media_type).toBe("image/jpeg");
    expect(Uint8Array.from(atob(image.source.data), (ch) => ch.charCodeAt(0))).toEqual(JPEG);
    expect(first.at(-1)?.cache_control).toEqual({ type: "ephemeral" }); // not re-billed at full price every step

    const files = t.gh.filesAt(body.commitSha);
    expect(files[`apps/site/public${url}`]).toBe(`base64:${btoa(String.fromCharCode(...JPEG))}`);
    expect(files[`${ROOT}/pages/meni.json`]).toContain(url);
  });

  it("images the model does not use are not committed", async () => {
    const t = await setup({ model: priceChangingModel() });
    const res = await t.editWithImages("Bučna juha naj stane 6,50 €", [{ name: "x.png", bytes: PNG }]);
    const body = (await res.json()) as { images: string[]; commitSha: string };
    expect(body.images).toEqual([]);
    expect(Object.keys(t.gh.filesAt(body.commitSha)).some((p) => p.includes("public/uploads"))).toBe(false);
  });

  it.each([
    ["an SVG (even named .jpg)", [{ name: "logo.jpg", bytes: SVG }], "image_type"],
    [
      "four images",
      Array.from({ length: 4 }, (_, i) => ({ name: `${i}.jpg`, bytes: JPEG })),
      "too_many_images",
    ],
  ])("refuses %s before calling the model", async (_case, images, error) => {
    const t = await setup();
    const res = await t.editWithImages("Dodaj sliko", images);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(t.callModel).not.toHaveBeenCalled();
  });

  it("a site whose schema has no uploads folder refuses images", async () => {
    const t = await setup();
    const head = t.gh.refs.get("demo/dev") as string;
    const schema = JSON.parse(demoSchemaText) as Record<string, unknown>;
    delete schema.uploads;
    const files = { ...t.gh.filesAt(head), [`${ROOT}/schema.json`]: JSON.stringify(schema) };
    t.gh.refs.set("demo/dev", t.gh.addCommit(files, [head], "no uploads"));
    const res = await t.editWithImages("Dodaj sliko", [{ name: "a.jpg", bytes: JPEG }]);
    expect(await res.json()).toEqual({ error: "uploads_not_supported" });
    expect(t.callModel).not.toHaveBeenCalled();
  });
});

describe("POST /api/sites/:siteId/edit", () => {
  it("a site without its schema.json cannot be edited: 503 site_schema_invalid, no model call, nothing logged", async () => {
    const t = await setup();
    const head = t.gh.refs.get("demo/dev") as string;
    const files = { ...t.gh.filesAt(head) };
    delete files[`${ROOT}/schema.json`];
    t.gh.refs.set("demo/dev", t.gh.addCommit(files, [head], "no schema"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await t.edit({ message: "Bučna juha naj stane 6,50 €" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "site_schema_invalid" });
    expect(t.callModel).not.toHaveBeenCalled();
    expect(t.log()).toEqual([]);
    expect(errors).toHaveBeenCalledWith("[sites] site schema:", expect.stringContaining("missing"));
  });

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
      images: [],
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
