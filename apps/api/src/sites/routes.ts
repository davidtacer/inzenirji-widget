import type { ErrorResponse, SessionInfo } from "@inzenirji/shared";
import { isValidSiteId } from "@inzenirji/shared/site-id";
import { type Context, Hono } from "hono";
import { runEdit } from "../agent/agent.ts";
import { type CallModel, ModelError } from "../agent/claude.ts";
import { costMicros, priceCents, sumUsage } from "../agent/pricing.ts";
import { bearerToken } from "../auth/routes.ts";
import { getSession, hitRateLimit } from "../auth/service.ts";
import { type GitHubContentStore, GitHubError, type RepoConfig, SiteSchemaError } from "../content/github.ts";
import type { Db } from "../db.ts";

export interface SiteRepoRow {
  owner: string;
  repo: string;
  devBranch: string;
  mainBranch: string;
  contentRoot: string;
  previewUrl: string;
  liveUrl: string;
}

export interface SiteRouteDeps {
  db: Db;
  now: () => number;
  /** Builds a store for a repo; null when GitHub access is not configured (no token). */
  storeFor: (repo: RepoConfig) => GitHubContentStore | null;
  /** Editing agent; without it POST /edit answers 503 agent_unavailable (no API key). */
  agent?: AgentConfig;
}

export interface AgentConfig {
  callModel: CallModel;
  model: string;
  usdToEur: number;
  /** Client price = cost × margin, rounded up to the cent (margin to be decided after phase 1). */
  margin: number;
}

export const EDIT_LIMIT_PER_HOUR = 30;
export const MAX_MESSAGE_CHARS = 2000;

export async function loadSiteRepo(db: Db, siteId: string): Promise<SiteRepoRow | null> {
  return db
    .prepare(
      `SELECT owner, repo, dev_branch AS devBranch, main_branch AS mainBranch, content_root AS contentRoot,
              preview_url AS previewUrl, live_url AS liveUrl
       FROM site_repos WHERE site_id = ?1`,
    )
    .bind(siteId)
    .first<SiteRepoRow>();
}

export async function logChange(
  db: Db,
  entry: {
    siteId: string;
    email: string;
    kind: "edit" | "publish" | "undo" | "discard";
    commitSha?: string | null;
    request?: string;
    reply?: string;
    model?: string;
    usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
    costMicros?: number;
    priceCents?: number;
    at: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO change_log (site_id, email, kind, request, reply, commit_sha, model, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, cost_micros, price_cents, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(
      entry.siteId,
      entry.email,
      entry.kind,
      entry.request ?? null,
      entry.reply ?? null,
      entry.commitSha ?? null,
      entry.model ?? null,
      entry.usage?.input ?? 0,
      entry.usage?.output ?? 0,
      entry.usage?.cacheRead ?? 0,
      entry.usage?.cacheWrite ?? 0,
      entry.costMicros ?? 0,
      entry.priceCents ?? 0,
      entry.at,
    )
    .run();
}

export type SiteContext = { session: SessionInfo; repo: SiteRepoRow; store: GitHubContentStore };

/**
 * Resolves the bearer session, checks it belongs to the site in the URL and builds the content store.
 * Returns a Response on failure.
 */
export async function siteContext(c: Context, deps: SiteRouteDeps): Promise<SiteContext | Response> {
  const siteId = c.req.param("siteId");
  const err = (error: string, status: 400 | 401 | 403 | 404 | 503) =>
    c.json<ErrorResponse>({ error }, status);
  if (!isValidSiteId(siteId)) return err("invalid_request", 400);
  const token = bearerToken(c.req.header("Authorization"));
  if (!token) return err("unauthorized", 401);
  const session = await getSession(deps, token);
  if (!session) return err("unauthorized", 401);
  if (session.siteId !== siteId) return err("wrong_site", 403);
  const repo = await loadSiteRepo(deps.db, siteId);
  if (!repo) return err("site_not_connected", 404);
  const store = deps.storeFor(repo);
  if (!store) return err("github_unavailable", 503);
  return { session, repo, store };
}

/** Maps GitHub failures to API errors; anything else is rethrown (→ 500). */
export function githubErrorResponse(c: Context, e: unknown): Response {
  if (e instanceof SiteSchemaError) {
    // A developer problem in the site's repo, not the owner's: logged with the reason, owner sees "not ready".
    console.error("[sites] site schema:", e.reason);
    return c.json<ErrorResponse>({ error: "site_schema_invalid" }, 503);
  }
  if (e instanceof GitHubError) {
    console.error("[sites] github error:", e.code, e.status);
    if (e.code === "conflict") return c.json<ErrorResponse>({ error: "conflict" }, 409);
    if (e.code === "nothing_to_undo") return c.json<ErrorResponse>({ error: "nothing_to_undo" }, 409);
    if (e.code === "not_installed") return c.json<ErrorResponse>({ error: "github_not_installed" }, 503);
    return c.json<ErrorResponse>({ error: "github_unavailable" }, 502);
  }
  throw e;
}

export function siteRoutes(deps: SiteRouteDeps) {
  const app = new Hono();

  app.get("/:siteId/status", async (c) => {
    const ctx = await siteContext(c, deps);
    if (ctx instanceof Response) return ctx;
    try {
      const s = await ctx.store.status();
      return c.json({
        unpublished: s.unpublished,
        previewSha: s.devSha,
        previewBuild: s.previewBuild,
        liveSha: s.mainSha,
        liveBuild: s.liveBuild,
        previewUrl: ctx.repo.previewUrl,
        liveUrl: ctx.repo.liveUrl,
      });
    } catch (e) {
      return githubErrorResponse(c, e);
    }
  });

  app.post("/:siteId/publish", async (c) => {
    const ctx = await siteContext(c, deps);
    if (ctx instanceof Response) return ctx;
    try {
      const res = await ctx.store.publish("objava sprememb s testne strani");
      if (res.merged) {
        await logChange(deps.db, {
          siteId: ctx.session.siteId,
          email: ctx.session.email,
          kind: "publish",
          commitSha: res.sha,
          at: deps.now(),
        });
      }
      return c.json({ published: res.merged, sha: res.sha, liveUrl: ctx.repo.liveUrl });
    } catch (e) {
      return githubErrorResponse(c, e);
    }
  });

  app.post("/:siteId/undo", async (c) => {
    const ctx = await siteContext(c, deps);
    if (ctx instanceof Response) return ctx;
    try {
      const res = await ctx.store.undoLastPublish();
      await logChange(deps.db, {
        siteId: ctx.session.siteId,
        email: ctx.session.email,
        kind: "undo",
        commitSha: res.sha,
        at: deps.now(),
      });
      return c.json({ undone: true, sha: res.sha, liveUrl: ctx.repo.liveUrl });
    } catch (e) {
      return githubErrorResponse(c, e);
    }
  });

  app.post("/:siteId/discard", async (c) => {
    const ctx = await siteContext(c, deps);
    if (ctx instanceof Response) return ctx;
    try {
      const sha = await ctx.store.discardDraft();
      await logChange(deps.db, {
        siteId: ctx.session.siteId,
        email: ctx.session.email,
        kind: "discard",
        commitSha: sha,
        at: deps.now(),
      });
      return c.json({ discarded: true });
    } catch (e) {
      return githubErrorResponse(c, e);
    }
  });

  app.post("/:siteId/edit", async (c) => {
    const ctx = await siteContext(c, deps);
    if (ctx instanceof Response) return ctx;
    const err = (error: string, status: 400 | 409 | 429 | 502 | 503) =>
      c.json<ErrorResponse>({ error }, status);
    if (!deps.agent) return err("agent_unavailable", 503);
    let message: unknown;
    try {
      message = ((await c.req.json()) as { message?: unknown }).message;
    } catch {
      return err("invalid_request", 400);
    }
    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_CHARS) {
      return err("invalid_request", 400);
    }
    const request = message.trim();
    const siteId = ctx.session.siteId;
    if (!(await hitRateLimit(deps.db, `edit-site:${siteId}`, EDIT_LIMIT_PER_HOUR, deps.now()))) {
      return err("rate_limited", 429);
    }

    let snapshot: Awaited<ReturnType<GitHubContentStore["read"]>>;
    try {
      snapshot = await ctx.store.read(ctx.repo.devBranch);
    } catch (e) {
      return githubErrorResponse(c, e);
    }
    const { results: history } = await deps.db
      .prepare(
        `SELECT request, reply, created_at AS at FROM change_log
         WHERE site_id = ?1 AND kind = 'edit' AND request IS NOT NULL AND reply IS NOT NULL
         ORDER BY id DESC LIMIT 5`,
      )
      .bind(siteId)
      .all<{ request: string; reply: string; at: number }>();

    const { agent } = deps;
    let result: Awaited<ReturnType<typeof runEdit>>;
    try {
      result = await runEdit({ snapshot, request, history }, agent.callModel, agent.model);
    } catch (e) {
      if (e instanceof ModelError) {
        console.error("[edit] model error:", e.status);
        return err("agent_unavailable", 502);
      }
      throw e;
    }

    const cost = costMicros(agent.model, result.usage, agent.usdToEur);
    const price = priceCents(cost, agent.margin);
    let commitSha: string | null = null;
    let conflict = false;
    if (result.changes.length > 0) {
      try {
        const subject = request.split("\n")[0]?.slice(0, 72) ?? "sprememba";
        commitSha = await ctx.store.commit(result.changes, `Urejevalnik: ${subject}`, snapshot.headSha);
      } catch (e) {
        if (e instanceof GitHubError && e.code === "conflict") conflict = true;
        else {
          await logChange(deps.db, {
            siteId,
            email: ctx.session.email,
            kind: "edit",
            request,
            reply: result.reply,
            model: agent.model,
            usage: sumUsage(result.usage),
            costMicros: cost,
            priceCents: price,
            at: deps.now(),
          });
          return githubErrorResponse(c, e);
        }
      }
    }
    // Every processed request is logged with its cost, also when nothing was committed.
    await logChange(deps.db, {
      siteId,
      email: ctx.session.email,
      kind: "edit",
      commitSha,
      request,
      reply: result.reply,
      model: agent.model,
      usage: sumUsage(result.usage),
      costMicros: cost,
      priceCents: price,
      at: deps.now(),
    });
    if (conflict) return err("conflict", 409);
    return c.json({
      reply: result.reply,
      changed: commitSha !== null,
      commitSha,
      files: result.changes.map((ch) => ch.path),
      escalated: result.escalated,
      previewUrl: ctx.repo.previewUrl,
      costMicros: cost,
      priceCents: price,
    });
  });

  return app;
}
