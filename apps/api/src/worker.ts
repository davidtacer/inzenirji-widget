import { configFromEnv, createApp } from "./app.ts";
import { createGitHubStore } from "./content/github.ts";
import type { Db } from "./db.ts";
import { consoleMailer, type Mailer, smtpMailer } from "./mailer.ts";

/** Bindings, vars and secrets of the Worker (see wrangler.jsonc). */
export interface WorkerEnv {
  /** Deployed commit SHA, set at deploy time with `--var GIT_SHA:<sha>`. */
  GIT_SHA?: string;
  /** D1 database (binding "DB"). */
  DB?: Db;
  /** "smtp" (deployed) or "console" (local dev only, via .dev.vars). */
  MAIL_TRANSPORT?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  /** Secret, set in the Cloudflare dashboard (or .dev.vars locally). */
  SMTP_PASSWORD?: string;
  MAIL_FROM?: string;
  MAIL_FROM_NAME?: string;
  /**
   * Secret: GitHub token with Contents read/write (+ Checks read) on the client repos (dev: a fine-grained token
   * for this repo, ADR-012). Without it /api/sites/* answers 503 github_unavailable.
   */
  GITHUB_TOKEN?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Picks the mail transport. The console transport prints login links, so it is only allowed for requests to a
 * local host; anything else gets null (auth then answers 503 instead of leaking links into logs).
 */
export function selectMailer(env: WorkerEnv, requestUrl: string): Mailer | null {
  const transport = env.MAIL_TRANSPORT ?? "smtp";
  if (transport === "console") {
    return LOCAL_HOSTS.has(new URL(requestUrl).hostname) ? consoleMailer() : null;
  }
  if (transport !== "smtp") return null;
  const port = Number(env.SMTP_PORT);
  if (!env.SMTP_HOST || !Number.isInteger(port) || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.MAIL_FROM) {
    return null;
  }
  return smtpMailer({
    host: env.SMTP_HOST,
    port,
    username: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    fromEmail: env.MAIL_FROM,
    fromName: env.MAIL_FROM_NAME ?? "Inženirji.si",
  });
}

/**
 * Cloudflare Worker entry (ADR-009). Static widget files are served by Workers static assets; only `/api/*`
 * reaches this code (`run_worker_first` in wrangler.jsonc).
 */
export default {
  fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContextLike): Response | Promise<Response> {
    const config = configFromEnv({ GIT_SHA: env.GIT_SHA });
    const mailer = env.DB ? selectMailer(env, request.url) : null;
    const auth =
      env.DB && mailer && ctx
        ? {
            auth: { db: env.DB, mailer, now: () => Date.now() },
            background: (work: Promise<unknown>) => ctx.waitUntil(work),
          }
        : undefined;
    const db = env.DB;
    const githubToken = env.GITHUB_TOKEN?.trim();
    const sites = db
      ? {
          db,
          now: () => Date.now(),
          storeFor: (repo: Parameters<typeof createGitHubStore>[0]) =>
            githubToken ? createGitHubStore(repo, githubToken) : null,
        }
      : undefined;
    return createApp({ ...config, ...(auth ? { auth } : {}), ...(sites ? { sites } : {}) }).fetch(request);
  },
};
