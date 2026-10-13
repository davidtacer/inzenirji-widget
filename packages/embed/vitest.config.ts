import { defineConfig } from "vitest/config";

// happy-dom never loads iframe pages (disabled by default) and logs one
// "Iframe page loading is disabled" line per mounted iframe. That log is expected.
export default defineConfig({
  test: { environment: "happy-dom" },
});
