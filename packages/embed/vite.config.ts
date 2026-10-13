import { defineConfig } from "vite";

// Builds a single self-executing file: dist/embed.js
export default defineConfig({
  build: {
    target: "es2020",
    emptyOutDir: true,
    lib: {
      entry: "src/index.ts",
      formats: ["iife"],
      name: "InzenirjiEmbed",
      fileName: () => "embed.js",
    },
  },
});
