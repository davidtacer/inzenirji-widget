import { describe, expect, it } from "vitest";
import { demoMenu, demoSchema } from "../testing/fixtures.ts";
import { isValidSlug, MAX_SCHEMA_BYTES, parseSiteSchema, validatorFor } from "./site-schema.ts";

describe("parseSiteSchema", () => {
  it("accepts the demo site's committed schema", () => {
    expect(demoSchema.version).toBe(1);
    expect(demoSchema.notes).toContain("priceCents");
  });

  it("refuses an oversized schema (it goes into every prompt)", () => {
    const big = JSON.stringify({ version: 1, notes: "x".repeat(MAX_SCHEMA_BYTES), site: {}, page: {} });
    expect(parseSiteSchema(big)).toEqual({ error: expect.stringContaining("larger than") });
  });

  it.each([
    [{ version: 1, site: { type: "object" }, page: { type: "array" } }, '"page" must be'],
    [{ version: 1, notes: 5, site: { type: "object" }, page: { type: "object" } }, "notes"],
    [
      {
        version: 1,
        site: { type: "object" },
        page: { type: "object", properties: { slug: {}, title: {} }, required: ["slug"] },
      },
      'require "title"',
    ],
  ])("refuses %j", (raw, reason) => {
    expect(parseSiteSchema(JSON.stringify(raw))).toEqual({ error: expect.stringContaining(reason) });
  });
});

describe("uploads folder (TASK-015)", () => {
  const base = {
    version: 1,
    site: { type: "object" },
    page: { type: "object", properties: { slug: {}, title: {} }, required: ["slug", "title"] },
  };
  it("demo: public/uploads served at /uploads", () => {
    expect(demoSchema.uploads).toEqual({ dir: "apps/site/public/uploads", publicPath: "/uploads" });
  });
  it("absent → no uploads", () => {
    expect((parseSiteSchema(JSON.stringify(base)) as { uploads: unknown }).uploads).toBeNull();
  });
  it.each([
    [{ dir: ".github/workflows", publicPath: "/x" }],
    [{ dir: "public/../.github", publicPath: "/x" }],
    [{ dir: "../outside", publicPath: "/x" }],
    [{ dir: "/abs", publicPath: "/x" }],
    [{ dir: "public/uploads", publicPath: "uploads" }],
    [{ dir: "public/uploads", publicPath: "/../x" }],
    [{ dir: "public/.hidden", publicPath: "/x" }],
  ])("refuses %j", (uploads) => {
    expect(parseSiteSchema(JSON.stringify({ ...base, uploads }))).toEqual({
      error: expect.stringContaining('"uploads"'),
    });
  });
});

describe("validatorFor (demo schema)", () => {
  const v = validatorFor(demoSchema);

  it("accepts valid content", () => {
    expect(v.page(demoMenu)).toEqual([]);
  });

  it("reports only the errors of the block kind that was written, with paths", () => {
    const page = structuredClone(demoMenu) as Record<string, unknown> & {
      blocks: Array<Record<string, unknown>>;
    };
    (page.blocks[0] as { heading: unknown }).heading = 5;
    (page.blocks[0] as { groups: Array<{ items: Array<{ priceCents: number }> }> }).groups[0]!
      .items[0]!.priceCents = 6.5;
    page.blocks.push({ type: "bogus" });
    page.extra = 1;
    expect(v.page(page)).toEqual([
      'blocks.0.heading: Instance type "number" is invalid. Expected "string".',
      'blocks.0.groups.0.items.0.priceCents: Instance type "number" is invalid. Expected "integer".',
      'blocks.1: does not match any allowed shape (check "type" and the schema)',
      '(root): property "extra" is not allowed here',
    ]);
  });

  it("keeps the template's link and image rules (regexes survive into JSON Schema)", () => {
    const page = {
      ...demoMenu,
      blocks: [{ type: "hero", heading: "x", image: { src: "/uploads/../x", alt: "a" } }],
    };
    expect(v.page(page).join("\n")).toContain("blocks.0.image.src");
    expect(v.page({ ...demoMenu, slug: "uredi" }).join("\n")).toContain("slug");
  });
});

describe("isValidSlug", () => {
  it.each([
    ["meni", true],
    ["o-nas-2", true],
    ["uredi", false],
    ["Meni", false],
    ["-x", false],
    ["../x", false],
  ])("%s → %s", (slug, ok) => {
    expect(isValidSlug(slug)).toBe(ok);
  });
});
