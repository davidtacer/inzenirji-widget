import { readFileSync } from "node:fs";
import { parseSiteSchema, type SiteSchema } from "../content/site-schema.ts";
import { sha256Hex } from "../crypto.ts";
import { FakeGitHub } from "./fake-github.ts";
import { createTestDb, seedSite } from "./sqlite-d1.ts";

export const DEMO = { id: "demo", name: "Gostilna Pri Lipi", origin: "https://demo.inzenirji.si" };
export const OTHER = { id: "drugi", name: "Druga stran", origin: "https://drugi.example" };
export const OWNER = "lastnik@example.com";
export const ROOT = "apps/site/content";
export const T0 = 1_760_000_000_000;

/** Smallest byte headers of real image formats (and an SVG with script, which must be refused). */
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
export const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

/** The demo site's real, committed schema (apps/site/content/schema.json, generated from its zod schema). */
export const demoSchemaText = readFileSync(
  new URL("../../../site/content/schema.json", import.meta.url),
  "utf8",
);
export const demoSchema = parseSiteSchema(demoSchemaText) as SiteSchema;

export const demoSite = {
  id: "demo",
  name: "Gostilna Pri Lipi",
  url: "https://demo.inzenirji.si",
  lang: "sl",
  contact: { phone: "02 123 45 67" },
  hours: [{ days: ["pon"], closed: true }],
  navigation: [{ label: "Domov", href: "/" }],
  theme: {
    colors: { primary: "#3f5b3a", background: "#fbf8f2", text: "#2a2722", accent: "#c8793b" },
    fonts: { heading: "Georgia", body: "system-ui" },
  },
};
export const demoHome = {
  slug: "index",
  title: "Gostilna Pri Lipi",
  seo: { description: "Domača kuhinja." },
  blocks: [{ type: "hero", heading: "Domača kuhinja" }],
};
export const demoMenu = {
  slug: "meni",
  title: "Meni",
  seo: { description: "Jesenski meni." },
  blocks: [
    {
      type: "menu",
      heading: "Kaj kuhamo",
      groups: [{ name: "Juhe", items: [{ name: "Bučna juha", priceCents: 550 }] }],
    },
  ],
};

/** A DB with two sites, the demo site connected to a fake GitHub repo, and one session per site. */
export async function contentFixture() {
  const db = createTestDb();
  seedSite(db, DEMO, [{ email: OWNER, role: "owner" }]);
  seedSite(db, OTHER, [{ email: "ana@drugi.example", role: "owner" }]);
  db.raw
    .prepare(
      `INSERT INTO site_repos (site_id, owner, repo, dev_branch, main_branch, content_root, preview_url, live_url)
       VALUES (?, 'acme', 'site', 'demo/dev', 'demo/main', ?, 'https://demo-dev.inzenirji.si', 'https://demo.inzenirji.si')`,
    )
    .run(DEMO.id, ROOT);

  const gh = new FakeGitHub();
  const initial = gh.addCommit(
    {
      "README.md": "template",
      [`${ROOT}/schema.json`]: demoSchemaText,
      [`${ROOT}/site.json`]: JSON.stringify(demoSite),
      [`${ROOT}/pages/index.json`]: JSON.stringify(demoHome),
      [`${ROOT}/pages/meni.json`]: JSON.stringify(demoMenu),
    },
    [],
    "initial",
  );
  gh.refs.set("demo/dev", initial);
  gh.refs.set("demo/main", initial);

  const session = "D".repeat(43);
  const otherSession = "E".repeat(43);
  for (const [token, site, email] of [
    [session, DEMO.id, OWNER],
    [otherSession, OTHER.id, "ana@drugi.example"],
  ] as const) {
    db.raw
      .prepare(
        "INSERT INTO sessions (token_hash, site_id, email, expires_at, created_at) VALUES (?, ?, ?, ?, 0)",
      )
      .run(await sha256Hex(token), site, email, T0 + 1e9);
  }
  return { db, gh, session, otherSession };
}
