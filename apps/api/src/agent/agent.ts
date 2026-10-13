import { contentJsonSchemas, Page, Site, Slug } from "@inzenirji/site-schema";
import type { ContentChange, ContentSnapshot } from "../content/github.ts";
import type { CallModel, ContentBlock, Message, ToolDef } from "./claude.ts";
import type { Usage } from "./pricing.ts";

/**
 * Level-1 editing agent (TASK-006): the model edits JSON content through tools; every write is validated
 * against the site schema; nothing leaves this function except a list of file changes.
 */
export const MAX_STEPS = 10;
export const MAX_TOKENS = 8192;

export interface EditInput {
  snapshot: ContentSnapshot;
  request: string;
  /** Recent changes of this site, newest first (from change_log). */
  history: Array<{ request: string; reply: string; at: number }>;
}

export interface EditResult {
  reply: string;
  changes: ContentChange[];
  usage: Usage[];
  escalated: boolean;
  /** "done" normally; otherwise why the agent stopped without a usable result. */
  outcome: "done" | "max_steps" | "max_tokens" | "refused";
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_pages",
    description: "List the site's pages with slug, title and block types.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_page",
    description: "Read one page as JSON.",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "read_site",
    description: "Read site.json (name, contact, opening hours, navigation, theme).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "write_page",
    description:
      "Create or replace one page. Pass the COMPLETE page JSON (slug, title, seo, blocks) following the page schema. " +
      "Returns 'ok' or validation errors to fix.",
    input_schema: {
      type: "object",
      properties: { page: { type: "object" } },
      required: ["page"],
      additionalProperties: false,
    },
  },
  {
    name: "write_site",
    description:
      "Replace site.json. Pass the COMPLETE site JSON following the site schema. Returns 'ok' or errors.",
    input_schema: {
      type: "object",
      properties: { site: { type: "object" } },
      required: ["site"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_page",
    description:
      "Delete a page (not the home page 'index'). Also remove it from the navigation with write_site.",
    input_schema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate",
    description:
      "Use when the request cannot be done with the existing blocks and fields (new kind of section, forms, " +
      "integrations, design changes, uploading new images), or is unclear/unsafe. Explain briefly why.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

let schemaText: { site: string; page: string } | null = null;

export function systemPrompt(siteName: string): string {
  // JSON Schema generation is pure but not free; compute once per Worker isolate (CPU budget).
  schemaText ??= (() => {
    const { site, page } = contentJsonSchemas();
    return { site: JSON.stringify(site), page: JSON.stringify(page) };
  })();
  const { site, page } = schemaText;
  return `You are the website editor for "${siteName}", a small business website built by Inženirji.si.
The site owner writes to you in Slovenian (sometimes casually, on a phone). You change the website's content by
editing JSON through tools. The design, layout and code cannot be changed.

Rules:
- Change only what the owner asked for. Keep everything else exactly as it is (copy unchanged fields verbatim).
- Read before you write: use read_page / read_site, then write the complete updated JSON.
- Prices are integer euro cents in "priceCents" (6,50 € → 650). Never use decimals for prices.
- Do not invent facts (phone numbers, addresses, prices, opening hours, dishes). If something needed is missing, ask.
- Images: only reuse image paths that already exist in the content. You cannot upload or create images.
- Slugs: lowercase letters, digits and hyphens; "index" is the home page; "uredi" is reserved.
- New pages: build them only from the existing block types; add them to site navigation if the owner wants them in the menu.
- If a write returns validation errors, fix the JSON and write again.
- If the request needs something the blocks cannot do, or is unclear, call escalate or ask a short question instead of guessing.
- Text on the website is Slovenian unless the owner asks otherwise. Use proper Slovenian (č, š, ž).
- When you are done, reply to the owner in Slovenian, formal "vi", 1–3 short sentences: what you changed, so they
  can check it on the test site. If you changed nothing, say why or ask your question. No markdown, no JSON.

Block types and fields are defined by these JSON Schemas.
Site schema (site.json):
${site}
Page schema (pages/<slug>.json):
${page}`;
}

/** Key-order-independent JSON for comparing content. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const fileText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function issuesOf(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .slice(0, 20)
    .map((i) => `- ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export async function runEdit(input: EditInput, callModel: CallModel, model: string): Promise<EditResult> {
  const original = input.snapshot;
  let site: unknown = structuredClone(original.site);
  const pages: Record<string, unknown> = structuredClone(original.pages);
  let escalated = false;
  const usage: Usage[] = [];

  const siteName = Site.safeParse(original.site).data?.name ?? "spletna stran";
  const historyText = input.history.length
    ? input.history
        .slice(0, 5)
        .map((h) => `- ${new Date(h.at).toISOString().slice(0, 10)}: "${h.request}" → ${h.reply}`)
        .join("\n")
    : "(no earlier changes)";
  const messages: Message[] = [
    {
      role: "user",
      content: `Recent changes on this site (newest first):\n${historyText}\n\nPages: ${Object.keys(pages).join(", ")}\n\nOwner's message:\n${input.request}`,
    },
  ];

  const runTool = (name: string, args: Record<string, unknown>): { text: string; isError?: boolean } => {
    switch (name) {
      case "list_pages":
        return {
          text: JSON.stringify(
            Object.entries(pages).map(([slug, p]) => {
              const page = p as { title?: string; blocks?: Array<{ type?: string }> };
              return { slug, title: page.title, blocks: (page.blocks ?? []).map((b) => b.type) };
            }),
          ),
        };
      case "read_page": {
        const slug = String(args.slug ?? "");
        return slug in pages
          ? { text: JSON.stringify(pages[slug]) }
          : { text: `No page "${slug}". Pages: ${Object.keys(pages).join(", ")}`, isError: true };
      }
      case "read_site":
        return { text: JSON.stringify(site) };
      case "write_page": {
        const parsed = Page.safeParse(args.page);
        if (!parsed.success) return { text: `Invalid page:\n${issuesOf(parsed.error)}`, isError: true };
        // Store what the model sent (defaults not applied), validated.
        pages[parsed.data.slug] = args.page;
        return { text: "ok" };
      }
      case "write_site": {
        const parsed = Site.safeParse(args.site);
        if (!parsed.success) return { text: `Invalid site.json:\n${issuesOf(parsed.error)}`, isError: true };
        if (parsed.data.id !== (original.site as { id?: string }).id) {
          return { text: "site.id must not change.", isError: true };
        }
        site = args.site;
        return { text: "ok" };
      }
      case "delete_page": {
        const slug = String(args.slug ?? "");
        if (slug === "index") return { text: "The home page cannot be deleted.", isError: true };
        if (!(slug in pages)) return { text: `No page "${slug}".`, isError: true };
        delete pages[slug];
        return { text: "ok" };
      }
      case "escalate":
        escalated = true;
        return { text: "Noted. Now explain to the owner in Slovenian that this needs Inženirji.si and why." };
      default:
        return { text: `Unknown tool ${name}`, isError: true };
    }
  };

  const finish = (reply: string, outcome: EditResult["outcome"]): EditResult => {
    if (outcome !== "done") return { reply, changes: [], usage, escalated, outcome };
    const changes: ContentChange[] = [];
    if (canonical(site) !== canonical(original.site))
      changes.push({ path: "site.json", content: fileText(site) });
    for (const [slug, page] of Object.entries(pages)) {
      if (!Slug.safeParse(slug).success && slug !== "index") continue; // never write odd file names
      if (canonical(page) !== canonical(original.pages[slug])) {
        changes.push({ path: `pages/${slug}.json`, content: fileText(page) });
      }
    }
    for (const slug of Object.keys(original.pages)) {
      if (!(slug in pages)) changes.push({ path: `pages/${slug}.json`, content: null });
    }
    return { reply, changes, usage, escalated, outcome };
  };

  const system = systemPrompt(siteName);
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callModel({
      model,
      system,
      tools: TOOLS,
      messages,
      maxTokens: MAX_TOKENS,
    });
    usage.push(res.usage);
    messages.push({ role: "assistant", content: res.content });

    if (res.stopReason === "tool_use") {
      const results: ContentBlock[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        const out = runTool(block.name, block.input ?? {});
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: out.text,
          ...(out.isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text.trim())
      .join("\n")
      .trim();
    if (res.stopReason === "max_tokens") {
      return finish(
        "Sprememba je bila predolga za eno sporočilo. Poskusite jo razdeliti na manjše korake.",
        "max_tokens",
      );
    }
    if (res.stopReason === "refusal") {
      return finish("Te spremembe ne morem narediti.", "refused");
    }
    return finish(text || "Končano.", "done");
  }
  return finish(
    "Te spremembe nisem uspel dokončati v enem koraku. Poskusite jo opisati bolj natančno ali po delih.",
    "max_steps",
  );
}
