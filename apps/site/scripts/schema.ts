// Writes content/schema.json — the content schema this site publishes for the editor (ADR-013,
// docs/guides/site-contract.md). `--check` fails when the committed file is out of date (CI).
import { readFileSync, writeFileSync } from "node:fs";
import { contentJsonSchemas } from "@inzenirji/site-schema";

const NOTES = `Gostilna Pri Lipi (demo).
- Prices are integer euro cents in "priceCents" (6,50 € → 650).
- Opening hours, phone, e-mail and address live in site.json; the "hours" and "contact" blocks only show them.
- Images: existing paths in the content (/uploads/...) or images the owner attached in the chat.
- Text on the website is Slovenian.`;

const { site, page } = contentJsonSchemas();
// Images attached in the chat are committed to public/uploads and served at /uploads (TASK-015).
const uploads = { dir: "apps/site/public/uploads", publicPath: "/uploads" };
const text = `${JSON.stringify({ version: 1, notes: NOTES, uploads, site, page }, null, 2)}\n`;
const file = new URL("../content/schema.json", import.meta.url);

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    // missing
  }
  if (current !== text) {
    console.error("content/schema.json is out of date: run `pnpm --filter @inzenirji/site schema`");
    process.exit(1);
  }
  console.log("content/schema.json is up to date");
} else {
  writeFileSync(file, text);
  console.log(`content/schema.json written (${text.length} bytes)`);
}
