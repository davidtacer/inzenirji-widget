import type { ContentChange, ContentSnapshot } from "../content/github.ts";
import { isValidSlug, type SiteSchema, validatorFor } from "../content/site-schema.ts";
import type { CallModel, ContentBlock, Message, ToolDef } from "./claude.ts";
import type { Usage } from "./pricing.ts";

/**
 * Level-1 editing agent (TASK-006): the model edits JSON content through tools; every write is validated
 * against the content schema the site itself publishes (ADR-013) — the agent knows no block types of its own.
 * Nothing leaves this function except a list of file changes.
 */
export const MAX_STEPS = 10;
export const MAX_TOKENS = 8192;

export interface EditInput {
  snapshot: ContentSnapshot;
  request: string;
  /** Recent changes of this site, newest first (from change_log). */
  history: Array<{ request: string; reply: string; at: number }>;
  /** Images the owner attached (TASK-015); the model sees them and may use their URLs in the content. */
  images?: Array<{ url: string; mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string }>;
  /** Extra system rules, e.g. for the public demo sandbox (ADR-015). */
  extraRules?: string;
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
    description: "Read site.json (site-wide content such as name, contact, navigation; see the site schema).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "write_page",
    description:
      "Create or replace one page. Pass the COMPLETE page JSON following the page schema (its slug is the file name). " +
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
      "Use when the request cannot be done with what the site schema allows (a new kind of section, forms, " +
      "integrations, design changes, uploading new images), or is unclear/unsafe. Explain briefly why.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

const prompts = new Map<string, string>();

/** System prompt for a site; the same text for every edit of a schema version, so it is cached by the API. */
export function systemPrompt(siteName: string, schema: SiteSchema, extraRules = ""): string {
  const key = `${siteName}\u0000${schema.text}\u0000${extraRules}`;
  const hit = prompts.get(key);
  if (hit) return hit;
  const text = `You are the website editor for "${siteName}", a website built by Inženirji.si.
The site owner writes to you in Slovenian (sometimes casually, on a phone). You change the website's content by
editing JSON through tools. The design, layout and code cannot be changed; what can be edited, and how, is defined
by this site's own JSON Schemas below (follow their field descriptions, e.g. units).

Rules:
- Change only what the owner asked for. Keep everything else exactly as it is (copy unchanged fields verbatim).
- Read before you write: use read_page / read_site, then write the complete updated JSON.
- Do not invent facts (phone numbers, addresses, prices, opening hours, names). If something needed is missing, ask.
- Images: use only image paths or URLs that already exist in the content, or the URLs of images the owner attached
  to this message (given next to each image). Write a short, factual Slovenian alt text from what you see. You
  cannot create or edit images. If the owner attached images but it is unclear where they belong, ask.
- Page slugs (file names): lowercase letters, digits and hyphens; "index" is the home page; "uredi" is reserved.
- New pages: build them only from what the page schema allows; add them to the site navigation if the site has one
  and the owner wants them in the menu.
- If a write returns validation errors, fix the JSON and write again.
- If the request needs something the schema does not allow, or is unclear, call escalate or ask a short question.
- Text on the website is Slovenian unless the site rules or the owner say otherwise. Use proper Slovenian (č, š, ž).
- When you are done, reply to the owner in Slovenian, formal "vi", 1–3 short sentences: what you changed. Do not
  say the change is already visible or tell them to check the test site: it needs a minute or two to rebuild and
  the editor shows that progress itself. If you changed nothing, say why or ask your question. No markdown, no JSON.

Rules of this site (from its developers):
${schema.notes.trim() || "(none)"}
${extraRules ? `\n${extraRules.trim()}\n` : ""}
Site schema (site.json):
${JSON.stringify(schema.site)}
Page schema (pages/<slug>.json):
${JSON.stringify(schema.page)}`;
  if (prompts.size >= 20) prompts.delete(prompts.keys().next().value as string);
  prompts.set(key, text);
  return text;
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

const listIssues = (issues: string[]) => issues.map((i) => `- ${i}`).join("\n");

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export async function runEdit(input: EditInput, callModel: CallModel, model: string): Promise<EditResult> {
  const original = input.snapshot;
  let site: unknown = structuredClone(original.site);
  const pages: Record<string, unknown> = structuredClone(original.pages);
  let escalated = false;
  const usage: Usage[] = [];

  const validate = validatorFor(original.schema);
  const siteRecord = isObject(original.site) ? original.site : {};
  const siteName =
    typeof siteRecord.name === "string" && siteRecord.name.trim() ? siteRecord.name : "spletna stran";
  const historyText = input.history.length
    ? input.history
        .slice(0, 5)
        .map((h) => `- ${new Date(h.at).toISOString().slice(0, 10)}: "${h.request}" → ${h.reply}`)
        .join("\n")
    : "(no earlier changes)";
  const intro = `Recent changes on this site (newest first):\n${historyText}\n\nPages: ${Object.keys(pages).join(", ")}\n\nOwner's message:\n${input.request}`;
  const images = input.images ?? [];
  const firstContent: Message["content"] = images.length
    ? [
        { type: "text", text: intro },
        ...images.flatMap((img, i): ContentBlock[] => [
          { type: "text", text: `Attached image ${i + 1}, use it as: ${img.url}` },
          { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } },
        ]),
      ]
    : intro;
  // Images are sent again with every step of the tool loop; cache them after the first step.
  if (Array.isArray(firstContent)) {
    const last = firstContent[firstContent.length - 1] as ContentBlock & { cache_control?: unknown };
    last.cache_control = { type: "ephemeral" };
  }
  const messages: Message[] = [{ role: "user", content: firstContent }];

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
        const page = args.page;
        const slug = isObject(page) && typeof page.slug === "string" ? page.slug : "";
        if (slug !== "index" && !isValidSlug(slug)) {
          return {
            text: 'Invalid page: "slug" must be "index" or lowercase letters, digits and hyphens (not "uredi").',
            isError: true,
          };
        }
        const issues = validate.page(page);
        if (issues.length) return { text: `Invalid page:\n${listIssues(issues)}`, isError: true };
        pages[slug] = page;
        return { text: "ok" };
      }
      case "write_site": {
        const next = args.site;
        const issues = validate.site(next);
        if (issues.length) return { text: `Invalid site.json:\n${listIssues(issues)}`, isError: true };
        if ("id" in siteRecord && (!isObject(next) || next.id !== siteRecord.id)) {
          return { text: "site.id must not change.", isError: true };
        }
        site = next;
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
      if (slug !== "index" && !isValidSlug(slug)) continue; // never write odd file names
      if (canonical(page) !== canonical(original.pages[slug])) {
        changes.push({ path: `pages/${slug}.json`, content: fileText(page) });
      }
    }
    for (const slug of Object.keys(original.pages)) {
      if (!(slug in pages)) changes.push({ path: `pages/${slug}.json`, content: null });
    }
    return { reply, changes, usage, escalated, outcome };
  };

  const system = systemPrompt(siteName, original.schema, input.extraRules);
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
