import { anthropicCaller } from "./agent/claude.ts";
import { isKnownModel } from "./agent/pricing.ts";
import { configFromEnv, createApp } from "./app.ts";
import { createGitHubStore, GitHubError, type RepoConfig, type TokenSource } from "./content/github.ts";
import { createAppAuth, type GitHubAppAuth } from "./content/github-app.ts";
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
   * Secret: GitHub token with Contents read/write on the client repos (check runs: public repo, or a GitHub App with Checks read later) (dev: a fine-grained token
   * for this repo, ADR-012). Without it /api/sites/* answers 503 github_unavailable.
   */
  GITHUB_TOKEN?: string;
  /** Secret: GitHub App ID (TASK-014). With GITHUB_APP_PRIVATE_KEY, sites are accessed through the app. */
  GITHUB_APP_ID?: string;
  /** Secret: the GitHub App's private key (.pem contents). */
  GITHUB_APP_PRIVATE_KEY?: string;
  /** Secret: Anthropic API key for the editing agent. Without it POST /edit answers 503 agent_unavailable. */
  ANTHROPIC_API_KEY?: string;
  /** Model id for edits (default claude-sonnet-5-5). */
  EDIT_MODEL?: string;
  /** USD → EUR rate for cost metering (default 0.92). */
  USD_TO_EUR?: string;
  /** Client price margin over AI cost (default 1 = cost price; billing is not live yet). */
  PRICE_MARGIN?: string;
}

const DEFAULT_MODEL = "claude-sonnet-5-5";

/** Agent configuration from env; null when there is no API key or the model has no known price. */
export function agentFromEnv(env: WorkerEnv) {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const model = env.EDIT_MODEL?.trim() || DEFAULT_MODEL;
  const usdToEur = Number(env.USD_TO_EUR ?? "0.92");
  const margin = Number(env.PRICE_MARGIN ?? "1");
  if (!apiKey || !isKnownModel(model) || !(usdToEur > 0) || !(margin >= 1)) return null;
  return { callModel: anthropicCaller(apiKey), model, usdToEur, margin };
}

// One app auth per isolate, so the key import, app JWT and installation tokens are reused across requests.
let appAuth: { key: string; auth: GitHubAppAuth } | null = null;

/**
 * How the API reaches a site's repo (TASK-014): through the GitHub App when it is configured; a repo where the app
 * is not installed falls back to GITHUB_TOKEN if there is one (dev / transition). Null when neither is configured.
 */
export function tokenSourceFor(
  env: Pick<WorkerEnv, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY" | "GITHUB_TOKEN">,
  repo: RepoConfig,
  makeAuth: typeof createAppAuth = createAppAuth,
): TokenSource | null {
  const githubToken = env.GITHUB_TOKEN?.trim() || null;
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !privateKey) return githubToken;
  const key = `${appId}:${privateKey.length}:${privateKey.slice(-32)}`;
  if (appAuth?.key !== key) appAuth = { key, auth: makeAuth({ appId, privateKey }) };
  const { auth } = appAuth;
  return async () => {
    try {
      return await auth.tokenFor(repo.owner, repo.repo);
    } catch (e) {
      if (githubToken && e instanceof GitHubError && e.code === "not_installed") return githubToken;
      throw e;
    }
  };
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
    const agent = agentFromEnv(env);
    const sites = db
      ? {
          db,
          now: () => Date.now(),
          storeFor: (repo: RepoConfig) => {
            const token = tokenSourceFor(env, repo);
            return token ? createGitHubStore(repo, token) : null;
          },
          ...(agent ? { agent } : {}),
        }
      : undefined;
    return createApp({ ...config, ...(auth ? { auth } : {}), ...(sites ? { sites } : {}) }).fetch(request);
  },
};
