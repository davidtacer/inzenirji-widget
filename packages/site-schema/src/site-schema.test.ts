import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Block, contentJsonSchemas, formatPrice, Page, Site, validateContent } from "./index.ts";

const contentDir = new URL("../../../apps/site/content/", import.meta.url);
const demoSite = JSON.parse(readFileSync(new URL("site.json", contentDir), "utf8"));
const demoPages: Record<string, unknown> = Object.fromEntries(
  readdirSync(new URL("pages/", contentDir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(new URL(`pages/${f}`, contentDir), "utf8"))]),
);

describe("demo content", () => {
  it("is valid", () => {
    expect(validateContent(demoSite, demoPages)).toEqual([]);
  });
});

describe("validateContent", () => {
  it("requires a home page", () => {
    const { index: _home, ...rest } = demoPages;
    expect(validateContent(demoSite, rest)).toContain("pages: index.json (home page) is required");
  });

  it("requires the slug to match the file name", () => {
    expect(validateContent(demoSite, { ...demoPages, cenik: demoPages.meni })).toContain(
      'pages/cenik.json: slug "meni" must match the file name',
    );
  });
});

describe("blocks", () => {
  const menu = (priceCents: unknown) => ({
    type: "menu",
    heading: "Meni",
    groups: [{ name: "Juhe", items: [{ name: "Juha", priceCents }] }],
  });

  it.each([
    [0, true],
    [650, true],
    [100_000_000, true],
    [100_000_001, false],
    [-1, false],
    [6.5, false],
    ["6,50", false],
  ])("menu price %j → valid %s", (price, ok) => {
    expect(Block.safeParse(menu(price)).success).toBe(ok);
  });

  it("rejects unknown block types and extra fields", () => {
    expect(Block.safeParse({ type: "carousel", images: [] }).success).toBe(false);
    expect(Block.safeParse({ type: "hours", color: "red" }).success).toBe(false);
  });

  it.each([
    ["/uploads/a.jpg", true],
    ["https://images.example.com/a.jpg", true],
    ["http://insecure.example/a.jpg", false],
    ["javascript:alert(1)", false],
    ["../secret.png", false],
    ["/uploads/../../etc/passwd", false],
  ])("image src %j → valid %s", (src, ok) => {
    expect(Block.safeParse({ type: "gallery", images: [{ src, alt: "x" }] }).success).toBe(ok);
  });

  it.each([
    ["/meni", true],
    ["/#kontakt", true],
    ["tel:021234567", true],
    ["mailto:a@b.si", true],
    ["https://example.com", true],
    ["//evil.example", false],
    ["javascript:alert(1)", false],
    ["http://example.com", false],
  ])("link %j → valid %s", (href, ok) => {
    const hero = { type: "hero", heading: "H", cta: { label: "Klik", href } };
    expect(Block.safeParse(hero).success).toBe(ok);
  });
});

describe("pages", () => {
  const base = { title: "T", seo: { description: "D" }, blocks: [{ type: "contact" }] };
  it.each([
    ["index", true],
    ["meni", true],
    ["o-nas", true],
    ["uredi", false],
    ["Meni", false],
    ["-meni", false],
    ["meni-", false],
    ["a".repeat(64), true],
    ["a".repeat(65), false],
  ])("slug %j → valid %s", (slug, ok) => {
    expect(Page.safeParse({ ...base, slug }).success).toBe(ok);
  });

  it("needs at least one block", () => {
    expect(Page.safeParse({ ...base, slug: "x", blocks: [] }).success).toBe(false);
  });
});

describe("site", () => {
  it("rejects bad colours and times", () => {
    const bad = structuredClone(demoSite);
    bad.theme.colors.primary = "green";
    expect(Site.safeParse(bad).success).toBe(false);
    const badTime = structuredClone(demoSite);
    badTime.hours[0].open = "24:00";
    expect(Site.safeParse(badTime).success).toBe(false);
  });
});

describe("formatPrice", () => {
  it.each([
    [0, "0,00 €"],
    [5, "0,05 €"],
    [650, "6,50 €"],
    [123456, "1.234,56 €"],
    [100_000_000, "1.000.000,00 €"],
  ])("%i → %s", (cents, out) => {
    expect(formatPrice(cents)).toBe(out);
  });
});

describe("contentJsonSchemas", () => {
  it("produces JSON Schemas for site and page", () => {
    const { site, page } = contentJsonSchemas();
    expect(site).toMatchObject({ type: "object" });
    expect(page).toMatchObject({ type: "object" });
    expect(JSON.stringify(page)).toContain("menu");
  });
});
