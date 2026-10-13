import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // node:sqlite (used by src/testing/sqlite-d1.ts) prints an ExperimentalWarning on Node 22.
    env: { NODE_NO_WARNINGS: "1" },
  },
});
