// Checks the static build in out/ against the template rules (ADR-011, docs/template/uredi-page.md).
// Usage: node scripts/check-build.mjs   (after `pnpm build`; SITE_PREVIEW=1 checks a preview build)
import { existsSync, readdirSync, readFileSync } from "node:fs";

const out = new URL("../out/", import.meta.url);
const read = (p) => readFileSync(new URL(p, out), "utf8");
const preview = process.env.SITE_PREVIEW === "1";
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

const pages = readdirSync(new URL("../content/pages/", import.meta.url))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));
for (const slug of pages) {
  const file = slug === "index" ? "index.html" : `${slug}.html`;
  check(existsSync(new URL(file, out)), `page ${slug} → ${file} exists`);
  if (existsSync(new URL(file, out))) {
    check(read(file).includes('class="site-header"'), `page ${slug} has the site header`);
  }
}

const uredi = read("uredi.html");
check(
  /<meta name="robots" content="noindex, nofollow"\/?>/.test(uredi),
  "/uredi has meta robots noindex, nofollow",
);
check(
  /<script src="https:\/\/[^"]+\/embed\.js" data-site="[a-z0-9-]+" defer/.test(uredi),
  "/uredi loads the embed script with data-site",
);
check(
  !uredi.includes('class="site-header"') && !uredi.includes('class="site-footer"'),
  "/uredi has no header/footer",
);

const robots = read("robots.txt");
if (preview) {
  check(/Disallow: \/\s*$/m.test(robots), "preview robots.txt disallows everything");
} else {
  check(/^Disallow: \/uredi$/m.test(robots), "robots.txt has Disallow: /uredi");
}
check(!read("sitemap.xml").includes("/uredi"), "sitemap.xml does not list /uredi");

const headers = read("_headers");
check(
  /\/uredi\n\s+X-Robots-Tag: noindex, nofollow/.test(headers) || (preview && headers.startsWith("/*\n")),
  "_headers: X-Robots-Tag for /uredi",
);
if (preview)
  check(/^\/\*\n\s+X-Robots-Tag: noindex, nofollow/.test(headers), "preview _headers: noindex on every path");

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall build checks passed");
