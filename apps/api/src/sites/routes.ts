import type { ErrorResponse, SessionInfo } from "@inzenirji/shared";
import { isValidSiteId } from "@inzenirji/shared/site-id";
import { type Context, Hono } from "hono";
import { bearerToken } from "../auth/routes.ts";
import { getSession } from "../auth/service.ts";
import { type GitHubContentStore, GitHubError, type RepoConfig } from "../content/github.ts";
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
}

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
  if (e instanceof GitHubError) {
    console.error("[sites] github error:", e.code, e.status);
    if (e.code === "conflict") return c.json<ErrorResponse>({ error: "conflict" }, 409);
    if (e.code === "nothing_to_undo") return c.json<ErrorResponse>({ error: "nothing_to_undo" }, 409);
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
        previewBuild: s.previewBuild,
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
      return c.json({ published: res.merged, liveUrl: ctx.repo.liveUrl });
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
      return c.json({ undone: true, liveUrl: ctx.repo.liveUrl });
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

  return app;
}
