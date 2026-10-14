import { describe, expect, it } from "vitest";
import { parseSiteSchema, type SiteSchema } from "../content/site-schema.ts";
import { demoHome, demoMenu, demoSchema, demoSite } from "../testing/fixtures.ts";
import { MAX_STEPS, runEdit, systemPrompt, TOOLS } from "./agent.ts";
import type { CallModel, ContentBlock, ModelRequest, ModelResponse } from "./claude.ts";
import { costMicros, priceCents } from "./pricing.ts";

const snapshot = {
  headSha: "abc",
  schema: demoSchema,
  site: demoSite,
  pages: { index: demoHome, meni: demoMenu },
};
const usage = { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 };
let n = 0;
const tool = (name: string, input: Record<string, unknown> = {}): ContentBlock => ({
  type: "tool_use",
  id: `t${++n}`,
  name,
  input,
});
const toolStep = (...blocks: ContentBlock[]): ModelResponse => ({
  content: blocks,
  stopReason: "tool_use",
  usage,
});
const final = (text: string): ModelResponse => ({
  content: [{ type: "text", text }],
  stopReason: "end_turn",
  usage,
});

/** A model that plays back responses and records what it was sent. */
function scripted(...steps: Array<ModelResponse | ((req: ModelRequest) => ModelResponse)>) {
  const requests: ModelRequest[] = [];
  const call: CallModel = async (req) => {
    requests.push(structuredClone(req));
    const step = steps[requests.length - 1];
    if (!step) throw new Error("model called more often than scripted");
    return typeof step === "function" ? step(req) : step;
  };
  return { call, requests };
}

const lastToolResults = (req: ModelRequest) =>
  (req.messages.at(-1)?.content as Array<{ type: string; content: string; is_error?: boolean }>) ?? [];

const newMenu = structuredClone(demoMenu);
(newMenu.blocks[0] as { groups: Array<{ items: Array<{ priceCents: number }> }> }).groups[0]!
  .items[0]!.priceCents = 650;

describe("runEdit", () => {
  it("reads, writes a valid page and returns exactly that file as a change", async () => {
    const m = scripted(
      toolStep(tool("read_page", { slug: "meni" })),
      toolStep(tool("write_page", { page: newMenu })),
      final("Ceno bučne juhe sem spremenil na 6,50 €."),
    );
    const res = await runEdit(
      { snapshot, request: "Bučna juha naj stane 6,50", history: [] },
      m.call,
      "claude-sonnet-5-5",
    );
    expect(res.outcome).toBe("done");
    expect(res.reply).toBe("Ceno bučne juhe sem spremenil na 6,50 €.");
    expect(res.changes).toEqual([
      { path: "pages/meni.json", content: `${JSON.stringify(newMenu, null, 2)}\n` },
    ]);
    expect(res.usage).toHaveLength(3);
    // the page JSON was handed to the model on read
    expect(JSON.parse(lastToolResults(m.requests[1]!)[0]!.content)).toEqual(demoMenu);
  });

  it("returns validation errors to the model, which fixes them; invalid content is never kept", async () => {
    const bad = structuredClone(newMenu);
    (bad.blocks[0] as { groups: Array<{ items: Array<{ priceCents: unknown }> }> }).groups[0]!
      .items[0]!.priceCents = 6.5;
    const m = scripted(
      toolStep(tool("write_page", { page: bad })),
      (req) => {
        const r = lastToolResults(req)[0]!;
        expect(r.is_error).toBe(true);
        expect(r.content).toContain("priceCents");
        return toolStep(tool("write_page", { page: newMenu }));
      },
      final("Popravljeno."),
    );
    const res = await runEdit({ snapshot, request: "6,50", history: [] }, m.call, "claude-sonnet-5-5");
    expect(res.changes.map((c) => c.path)).toEqual(["pages/meni.json"]);
    expect(res.changes[0]?.content).toContain('"priceCents": 650');
  });

  it("a write that changes nothing (only key order) produces no change", async () => {
    const reordered = {
      blocks: demoMenu.blocks,
      seo: demoMenu.seo,
      title: demoMenu.title,
      slug: demoMenu.slug,
    };
    const m = scripted(
      toolStep(tool("write_page", { page: reordered })),
      final("Ni bilo treba ničesar spremeniti."),
    );
    const res = await runEdit({ snapshot, request: "x", history: [] }, m.call, "claude-sonnet-5-5");
    expect(res.changes).toEqual([]);
  });

  it("creates and deletes pages; the home page cannot be deleted", async () => {
    const newPage = {
      slug: "zaposlitev",
      title: "Zaposlitev",
      seo: { description: "Iščemo natakarja." },
      blocks: [{ type: "text", body: "Iščemo natakarja." }],
    };
    const m = scripted(
      toolStep(
        tool("delete_page", { slug: "index" }),
        tool("delete_page", { slug: "meni" }),
        tool("write_page", { page: newPage }),
      ),
      (req) => {
        const results = lastToolResults(req);
        expect(results[0]?.is_error).toBe(true);
        expect(results[1]?.content).toBe("ok");
        expect(results[2]?.content).toBe("ok");
        return final("Dodal sem stran Zaposlitev in odstranil meni.");
      },
    );
    const res = await runEdit({ snapshot, request: "x", history: [] }, m.call, "claude-sonnet-5-5");
    expect(res.changes.map((c) => [c.path, c.content === null])).toEqual([
      ["pages/zaposlitev.json", false],
      ["pages/meni.json", true],
    ]);
  });

  it.each([
    ["uredi", '(not "uredi")'],
    ["../hack", "lowercase letters"],
    ["Velike", "lowercase letters"],
  ])("rejects page slug %j", async (slug, msg) => {
    const page = { ...demoMenu, slug };
    const m = scripted(toolStep(tool("write_page", { page })), (req) => {
      expect(lastToolResults(req)[0]!.content).toContain(msg);
      return final("Ne gre.");
    });
    const res = await runEdit({ snapshot, request: "x", history: [] }, m.call, "claude-sonnet-5-5");
    expect(res.changes).toEqual([]);
  });

  it("site.json changes are validated and the site id cannot change", async () => {
    const newSite = { ...demoSite, contact: { ...demoSite.contact, phone: "041 111 222" } };
    const m = scripted(
      toolStep(tool("write_site", { site: { ...newSite, id: "drug" } })),
      (req) => {
        expect(lastToolResults(req)[0]!.content).toBe("site.id must not change.");
        return toolStep(tool("write_site", { site: newSite }));
      },
      final("Nova telefonska je 041 111 222."),
    );
    const res = await runEdit(
      { snapshot, request: "nova številka", history: [] },
      m.call,
      "claude-sonnet-5-5",
    );
    expect(res.changes.map((c) => c.path)).toEqual(["site.json"]);
    expect(res.changes[0]?.content).toContain("041 111 222");
  });

  it("escalate marks the result and still returns the reply", async () => {
    const m = scripted(
      toolStep(tool("escalate", { reason: "spletna trgovina" })),
      final("Za spletno trgovino se obrnite na nas."),
    );
    const res = await runEdit(
      { snapshot, request: "dodaj trgovino", history: [] },
      m.call,
      "claude-sonnet-5-5",
    );
    expect(res.escalated).toBe(true);
    expect(res.changes).toEqual([]);
  });

  it(`stops after ${MAX_STEPS} model calls without changes`, async () => {
    const steps = Array.from({ length: MAX_STEPS }, () => toolStep(tool("write_page", { page: newMenu })));
    const m = scripted(...steps);
    const res = await runEdit({ snapshot, request: "x", history: [] }, m.call, "claude-sonnet-5-5");
    expect(res.outcome).toBe("max_steps");
    expect(res.changes).toEqual([]);
    expect(m.requests).toHaveLength(MAX_STEPS);
  });

  it("max_tokens and refusal discard changes", async () => {
    for (const stopReason of ["max_tokens", "refusal"]) {
      const m = scripted(toolStep(tool("write_page", { page: newMenu })), { content: [], stopReason, usage });
      const res = await runEdit({ snapshot, request: "x", history: [] }, m.call, "claude-sonnet-5-5");
      expect(res.changes).toEqual([]);
      expect(res.outcome).not.toBe("done");
    }
  });

  it("sends schema, rules, tools, history and the owner's message", async () => {
    const m = scripted(final("Ok."));
    await runEdit(
      {
        snapshot,
        request: "Dodaj ajdove žgance",
        history: [{ request: "Nova cena", reply: "Spremenjeno.", at: 1_760_000_000_000 }],
      },
      m.call,
      "claude-sonnet-5-5",
    );
    const req = m.requests[0]!;
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.tools).toEqual(TOOLS);
    expect(req.system).toBe(systemPrompt("Gostilna Pri Lipi", demoSchema));
    expect(req.system).toContain("priceCents");
    expect(req.system).toContain(demoSchema.notes); // the site's own rules
    expect(req.system).toContain("6,50 € is 650"); // field description from the site's zod schema
    const msg = req.messages[0]!.content as string;
    expect(msg).toContain("Dodaj ajdove žgance");
    expect(msg).toContain('"Nova cena" → Spremenjeno.');
    expect(msg).toContain("index, meni");
  });
});

describe("pricing", () => {
  it("Sonnet 5.5: 10k input + 1k output ≈ 0.03 USD → micro-euros, rounded up", () => {
    // 10 000 × 2 + 1 000 × 10 = 30 000 micro-USD × 0.92 = 27 600 micro-euros
    expect(
      costMicros("claude-sonnet-5-5", [{ input: 10_000, output: 1_000, cacheRead: 0, cacheWrite: 0 }], 0.92),
    ).toBe(27_600);
  });

  it("cache reads are cheap and sum over requests", () => {
    const u = { input: 100, output: 100, cacheRead: 10_000, cacheWrite: 0 };
    // per request: 100×2 + 100×10 + 10 000×0.2 = 3 200 micro-USD; ×2 = 6 400; ×1 = 6 400
    expect(costMicros("claude-sonnet-5-5", [u, u], 1)).toBe(6_400);
  });

  it("Haiku 5.5 uses the higher rate above 100k prompt tokens, for every line", () => {
    const under = { input: 100_000, output: 1_000, cacheRead: 0, cacheWrite: 0 };
    const over = { input: 100_001, output: 1_000, cacheRead: 0, cacheWrite: 0 };
    expect(costMicros("claude-haiku-5-5", [under], 1)).toBe(10_000 + 500);
    expect(costMicros("claude-haiku-5-5", [over], 1)).toBe(Math.ceil(100_001 * 0.5 + 2_500));
  });

  it("unknown models throw", () => {
    expect(() => costMicros("gpt-x", [{ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }], 1)).toThrow();
  });

  it.each([
    [0, 1, 0],
    [1, 1, 1],
    [10_000, 1, 1],
    [10_001, 1, 2],
    [27_600, 3, 9],
  ])("price of %i micro-euros × %i = %i cents", (cost, margin, cents) => {
    expect(priceCents(cost, margin)).toBe(cents);
  });
});

describe("runEdit on a site with its own blocks (ADR-013)", () => {
  // A studio site whose developers designed a "timeline" block; it has nothing from the demo template.
  const studioSchema = parseSiteSchema(
    JSON.stringify({
      version: 1,
      notes: "Letnice so štirimestne. Besedila v angleščini ne prevajaj.",
      site: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
      page: {
        type: "object",
        properties: {
          slug: { type: "string" },
          title: { type: "string" },
          sections: {
            type: "array",
            items: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    type: { const: "timeline" },
                    events: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          year: { type: "integer", minimum: 1900, maximum: 2100 },
                          text: { type: "string" },
                        },
                        required: ["year", "text"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["type", "events"],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
        required: ["slug", "title", "sections"],
        additionalProperties: false,
      },
    }),
  ) as SiteSchema;
  const studio = {
    headSha: "s1",
    schema: studioSchema,
    site: { name: "Studio Lipa" },
    pages: {
      index: {
        slug: "index",
        title: "Studio",
        sections: [{ type: "timeline", events: [{ year: 2019, text: "Začetek" }] }],
      },
    },
  };

  it("edits the site's own block and rejects blocks the site does not have", async () => {
    const updated = {
      slug: "index",
      title: "Studio",
      sections: [
        {
          type: "timeline",
          events: [
            { year: 2019, text: "Začetek" },
            { year: 2024, text: "Nov atelje" },
          ],
        },
      ],
    };
    const m = scripted(
      toolStep(
        tool("write_page", {
          page: { ...updated, sections: [{ type: "menu", heading: "Meni", groups: [] }] },
        }),
      ),
      (req) => {
        expect(lastToolResults(req)[0]!.is_error).toBe(true);
        return toolStep(
          tool("write_page", {
            page: { ...updated, sections: [{ type: "timeline", events: [{ year: 24, text: "x" }] }] },
          }),
        );
      },
      (req) => {
        expect(lastToolResults(req)[0]!.content).toContain("sections.0.events.0.year");
        return toolStep(tool("write_page", { page: updated }));
      },
      (req) => {
        expect(lastToolResults(req)[0]!.content).toBe("ok");
        return final("Dodal sem leto 2024.");
      },
    );
    const res = await runEdit(
      { snapshot: studio, request: "Dodaj 2024 nov atelje", history: [] },
      m.call,
      "claude-sonnet-5-5",
    );
    expect(res.changes).toEqual([
      { path: "pages/index.json", content: `${JSON.stringify(updated, null, 2)}\n` },
    ]);
    const system = m.requests[0]!.system;
    expect(system).toContain('"Studio Lipa"');
    expect(system).toContain("Letnice so štirimestne.");
    expect(system).toContain('"timeline"');
    expect(system).not.toContain("priceCents"); // nothing from the demo template
  });
});
