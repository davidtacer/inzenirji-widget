// Writes out/_headers for Cloudflare static assets (ADR-011): /uredi is never indexed; a preview build
// (SITE_PREVIEW=1, hidden test site) sends noindex for every path.
import { writeFileSync } from "node:fs";

const noindex = "  X-Robots-Tag: noindex, nofollow\n";
const rules =
  process.env.SITE_PREVIEW === "1"
    ? `/*\n${noindex}`
    : `/uredi\n${noindex}/uredi.html\n${noindex}/uredi/*\n${noindex}`;
writeFileSync(new URL("../out/_headers", import.meta.url), rules);
console.log(`[postbuild] out/_headers written (${process.env.SITE_PREVIEW === "1" ? "preview" : "live"})`);
