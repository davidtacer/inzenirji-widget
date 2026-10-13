import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

const embedFile = fileURLToPath(new URL("../../packages/embed/dist/embed.js", import.meta.url));

/**
 * Serves the built embed script at /embed.js in dev and copies it into the widget build, so widget,
 * embed and API share one origin (uredi.inzenirji.si). The embed package must be built first.
 */
function embedScript(): Plugin {
  return {
    name: "inzenirji-embed-script",
    configureServer(server) {
      server.middlewares.use("/embed.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(readFileSync(embedFile));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "embed.js", source: readFileSync(embedFile) });
    },
  };
}

export default defineConfig({
  plugins: [preact(), embedScript()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { target: "es2020" },
});
