import { configFromEnv, createApp } from "./app.ts";

/** Bindings and vars available to the Worker (see wrangler.jsonc). */
export interface WorkerEnv {
  /** Deployed commit SHA, set at deploy time with `--var GIT_SHA:<sha>`. */
  GIT_SHA?: string;
}

/**
 * Cloudflare Worker entry (ADR-009). Static widget files (index.html, assets, embed.js) are served by
 * Workers static assets; only `/api/*` reaches this code (`run_worker_first` in wrangler.jsonc).
 */
export default {
  fetch(request: Request, env: WorkerEnv): Response | Promise<Response> {
    return createApp(configFromEnv({ GIT_SHA: env.GIT_SHA })).fetch(request);
  },
};
