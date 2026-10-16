import { Page, Site, validateContent } from "@inzenirji/site-schema";

export type DemoContent = { site: Site; pages: Record<string, Page> };

/**
 * Reads a `widget:demo-content` message from the editor (TASK-016). The content comes from the visitor's sandbox,
 * so it is validated with the same schema as a real build before anything is rendered. Null when invalid.
 */
export function parseDemoMessage(data: unknown): { content: DemoContent; page: string | null } | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as { v?: unknown; type?: unknown; content?: unknown; page?: unknown };
  if (msg.v !== 1 || msg.type !== "widget:demo-content") return null;
  const raw = msg.content as { site?: unknown; pages?: unknown } | null;
  if (!raw || typeof raw.pages !== "object" || raw.pages === null) return null;
  const rawPages = raw.pages as Record<string, unknown>;
  if (validateContent(raw.site, rawPages).length > 0) return null;
  const pages: Record<string, Page> = {};
  for (const [slug, p] of Object.entries(rawPages)) pages[slug] = Page.parse(p);
  const page = typeof msg.page === "string" && msg.page in pages ? msg.page : null;
  return { content: { site: Site.parse(raw.site), pages }, page };
}

/** "/meni" → "meni", "/" → "index", "/#kontakt" → "index" (+ hash); null for links outside the site. */
export function slugOfHref(href: string): { slug: string; hash: string } | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const [path = "/", hash = ""] = href.split("#");
  const clean = path.replace(/\/+$/, "");
  return { slug: clean === "" ? "index" : clean.slice(1), hash };
}

/** Index of the first block that differs on `slug` between two contents (0 when the page is new or equal). */
export function firstChangedBlock(before: DemoContent, after: DemoContent, slug: string): number {
  const a = before.pages[slug]?.blocks ?? [];
  const b = after.pages[slug]?.blocks ?? [];
  for (let i = 0; i < b.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i;
  }
  return 0;
}
