import { type OutputUnit, Validator } from "@cfworker/json-schema";

/**
 * The content schema a site publishes in its own repo (ADR-013): `<contentRoot>/schema.json`.
 * The editor knows no block types of its own; everything the agent may write is defined here, per site.
 * Contract for site developers: docs/guides/site-contract.md.
 */
export interface SiteSchema {
  version: 1;
  /** Site-specific rules for the editing agent (units, tone, what not to touch). */
  notes: string;
  /** JSON Schema (draft 2020-12) of `site.json`. */
  site: Record<string, unknown>;
  /** JSON Schema (draft 2020-12) of every `pages/<slug>.json`. */
  page: Record<string, unknown>;
  /**
   * Where images uploaded in the chat are stored (TASK-015): `dir` is relative to the repo root, `publicPath` is
   * the URL path the site serves that folder at. Absent → the site does not accept uploads.
   */
  uploads: { dir: string; publicPath: string } | null;
  /** The schema file as committed; used as cache key. */
  text: string;
}

/** Repo-relative folder: plain segments only (no "..", no hidden folders such as .github). */
const UPLOAD_DIR = /^(?!.*(?:^|\/)\.)[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const PUBLIC_PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)?$/;

export const SCHEMA_FILE = "schema.json";
/** The whole schema goes into the agent's prompt on every edit; keep it bounded (cost, CPU). */
export const MAX_SCHEMA_BYTES = 200_000;
export const MAX_NOTES_CHARS = 4_000;

/** Page file names: lowercase letters, digits, hyphens; "index" is the home page; "uredi" is the editor (ADR-011). */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug) && slug !== "uredi";
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses and checks a schema file. Returns the schema, or a reason it cannot be used. */
export function parseSiteSchema(text: string): SiteSchema | { error: string } {
  if (new TextEncoder().encode(text).length > MAX_SCHEMA_BYTES) {
    return { error: `schema.json is larger than ${MAX_SCHEMA_BYTES} bytes` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "schema.json is not valid JSON" };
  }
  if (!isObject(raw)) return { error: "schema.json must be an object" };
  if (raw.version !== 1) return { error: "schema.json: version must be 1" };
  const notes = raw.notes ?? "";
  if (typeof notes !== "string" || notes.length > MAX_NOTES_CHARS) {
    return { error: `schema.json: notes must be a string of at most ${MAX_NOTES_CHARS} characters` };
  }
  const { site, page } = raw;
  if (!isObject(site) || site.type !== "object") {
    return { error: 'schema.json: "site" must be a JSON Schema of type object' };
  }
  if (!isObject(page) || page.type !== "object") {
    return { error: 'schema.json: "page" must be a JSON Schema of type object' };
  }
  // The editor itself relies on these page fields (file name, page list).
  const props = isObject(page.properties) ? page.properties : {};
  const required = Array.isArray(page.required) ? page.required : [];
  for (const field of ["slug", "title"]) {
    if (!(field in props) || !required.includes(field)) {
      return { error: `schema.json: page schema must require "${field}"` };
    }
  }
  let uploads: SiteSchema["uploads"] = null;
  if (raw.uploads !== undefined) {
    const u = raw.uploads;
    if (
      !isObject(u) ||
      typeof u.dir !== "string" ||
      typeof u.publicPath !== "string" ||
      !UPLOAD_DIR.test(u.dir) ||
      u.dir.split("/").includes("..") ||
      !PUBLIC_PATH.test(u.publicPath) ||
      u.publicPath.split("/").includes("..")
    ) {
      return { error: 'schema.json: "uploads" must be { dir: "<repo folder>", publicPath: "/<url path>" }' };
    }
    uploads = { dir: u.dir, publicPath: u.publicPath.replace(/\/$/, "") };
  }
  try {
    new Validator(site, "2020-12", false);
    new Validator(page, "2020-12", false);
  } catch {
    return { error: "schema.json: site or page schema cannot be compiled" };
  }
  return { version: 1, notes, site, page, uploads, text };
}

export interface ContentValidator {
  /** Human-readable problems, empty when valid. */
  site(value: unknown): string[];
  page(value: unknown): string[];
}

const MAX_ISSUES = 20;
/** Keywords whose units only summarise nested errors (or repeat them, like "false"). */
const SUMMARY = new Set(["properties", "items", "prefixItems", "allOf", "$ref", "false"]);
/** A branch of a union whose "type" discriminator did not match: its errors are about another kind of block. */
const WRONG_KIND = /^(.*\/(?:oneOf|anyOf)\/\d+)\/properties\/type\/(?:const|enum)$/;

/**
 * Turns validator output into a short list the model can act on. Unions of blocks ("oneOf" by "type") produce
 * errors for every block kind; only the errors of the kind the model actually wrote are kept.
 */
export function issues(units: OutputUnit[]): string[] {
  // The same schema branch is used for every item of a list, so a branch is wrong for one instance (block) only.
  const wrong = units.flatMap((u) => {
    const m = u.keywordLocation.match(WRONG_KIND);
    return m ? [{ branch: m[1] as string, instance: u.instanceLocation.replace(/\/type$/, "") }] : [];
  });
  const under = (loc: string, base: string) => loc === base || loc.startsWith(`${base}/`);
  const inWrongBranch = (u: OutputUnit) =>
    wrong.some((w) => under(u.keywordLocation, w.branch) && under(u.instanceLocation, w.instance));
  const kept = units.filter((u) => !SUMMARY.has(u.keyword) && !inWrongBranch(u));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of kept) {
    if (u.keyword === "oneOf" || u.keyword === "anyOf") {
      // A union is only worth reporting when none of its branches explains the problem.
      const explained = kept.some(
        (o) =>
          o !== u &&
          o.keywordLocation.startsWith(`${u.keywordLocation}/`) &&
          under(o.instanceLocation, u.instanceLocation),
      );
      if (explained) continue;
    }
    const where = u.instanceLocation.replace(/^#\/?/, "").replaceAll("/", ".") || "(root)";
    const extra = u.error.match(/^Property "(.+)" does not match additional properties schema\.$/);
    // The validator also lists known properties that failed their own schema here; those are reported below.
    if (extra && kept.some((o) => under(o.instanceLocation, `${u.instanceLocation}/${extra[1]}`))) continue;
    const what =
      u.keyword === "oneOf" || u.keyword === "anyOf"
        ? 'does not match any allowed shape (check "type" and the schema)'
        : extra
          ? `property "${extra[1]}" is not allowed here`
          : u.error;
    const line = `${where}: ${what}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

const cache = new Map<string, ContentValidator>();

/** Validator for a site's schema; compiled once per schema version per Worker isolate. */
export function validatorFor(schema: SiteSchema): ContentValidator {
  const hit = cache.get(schema.text);
  if (hit) return hit;
  const site = new Validator(schema.site, "2020-12", false);
  const page = new Validator(schema.page, "2020-12", false);
  const v: ContentValidator = {
    site: (value) => {
      const r = site.validate(value);
      return r.valid ? [] : issues(r.errors);
    },
    page: (value) => {
      const r = page.validate(value);
      return r.valid ? [] : issues(r.errors);
    },
  };
  if (cache.size >= 20) cache.delete(cache.keys().next().value as string);
  cache.set(schema.text, v);
  return v;
}
