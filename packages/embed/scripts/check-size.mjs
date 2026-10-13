// Fails when the gzipped size of a file exceeds a byte budget. Usage: node check-size.mjs <file> <maxBytes>
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const [file, maxArg] = process.argv.slice(2);
const max = Number(maxArg);
if (!file || !Number.isInteger(max) || max <= 0) {
  console.error("usage: check-size.mjs <file> <maxBytes>");
  process.exit(2);
}
const raw = readFileSync(file);
const gz = gzipSync(raw, { level: 9 }).length;
console.log(`${file}: ${raw.length} B raw, ${gz} B gzipped (budget ${max} B)`);
if (gz > max) {
  console.error(`FAIL: ${gz} B gzipped exceeds budget of ${max} B`);
  process.exit(1);
}
console.log("OK");
