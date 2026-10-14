import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Page,
  Page as PageSchema,
  Site,
  type Site as SiteType,
  validateContent,
} from "@inzenirji/site-schema";

/**
 * Reads and validates the site's content at build time. An invalid content file fails the build, so a broken
 * edit can never reach the live site (the editor validates before committing, this is the second gate).
 */
const CONTENT_DIR = join(process.cwd(), "content");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

let cache: { site: SiteType; pages: Record<string, Page> } | null = null;

export function loadContent(): { site: SiteType; pages: Record<string, Page> } {
  if (cache) return cache;
  const rawSite = readJson(join(CONTENT_DIR, "site.json"));
  const rawPages: Record<string, unknown> = {};
  for (const file of readdirSync(join(CONTENT_DIR, "pages"))) {
    if (file.endsWith(".json")) rawPages[file.slice(0, -5)] = readJson(join(CONTENT_DIR, "pages", file));
  }
  const issues = validateContent(rawSite, rawPages);
  if (issues.length > 0) {
    throw new Error(`Invalid site content:\n- ${issues.join("\n- ")}`);
  }
  const pages: Record<string, Page> = {};
  for (const [slug, raw] of Object.entries(rawPages)) pages[slug] = PageSchema.parse(raw);
  cache = { site: Site.parse(rawSite), pages };
  return cache;
}

export function pagePath(slug: string): string {
  return slug === "index" ? "/" : `/${slug}`;
}
