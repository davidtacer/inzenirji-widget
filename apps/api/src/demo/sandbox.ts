import type { ContentChange, ContentSnapshot, GitHubContentStore, RepoConfig } from "../content/github.ts";
import type { SiteSchema } from "../content/site-schema.ts";
import type { Db } from "../db.ts";
import { loadSiteRepo } from "../sites/routes.ts";

/**
 * Public editor demo (TASK-016, ADR-015): every visitor edits a private copy of the demo site's content that lives
 * in D1, never in git. The starting content is the live demo site (`main` branch of the demo site's repo).
 */

/** Edits without an e-mail, and the extra edits an e-mail unlocks (product plan §6). */
export const FREE_EDITS = 5;
export const EMAIL_EDITS = 10;
export const SANDBOX_TTL_MS = 24 * 60 * 60_000;
/** Rows (no content) are kept this long for the funnel numbers. */
export const KEEP_ROWS_MS = 90 * 24 * 60 * 60_000;

export interface SandboxContent {
  site: unknown;
  pages: Record<string, unknown>;
}

export interface Template extends SandboxContent {
  schema: SiteSchema;
}

export interface SandboxRow {
  tokenHash: string;
  content: string | null;
  edits: number;
  email: string | null;
  createdAt: number;
  expiresAt: number;
}

export const editLimit = (row: { email: string | null }) => FREE_EDITS + (row.email ? EMAIL_EDITS : 0);

/**
 * Loads the demo template once per isolate and keeps it for `ttlMs` (the live demo changes rarely; a stale copy
 * for a few minutes is fine). A failed load is not cached.
 */
export function templateLoader(
  db: Db,
  storeFor: (repo: RepoConfig) => GitHubContentStore | null,
  siteId: string,
  now: () => number,
  ttlMs = 10 * 60_000,
): () => Promise<Template | null> {
  let cached: { at: number; value: Template } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    const repo = await loadSiteRepo(db, siteId);
    if (!repo) return null;
    const store = storeFor(repo);
    if (!store) return null;
    const snap = await store.read(repo.mainBranch);
    const value: Template = { schema: snap.schema, site: snap.site, pages: snap.pages };
    cached = { at: now(), value };
    return value;
  };
}

export async function createSandbox(
  db: Db,
  input: { tokenHash: string; content: SandboxContent; ipHash: string; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO demo_sandboxes (token_hash, content, ip_hash, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.tokenHash, JSON.stringify(input.content), input.ipHash, input.now, input.now + SANDBOX_TTL_MS)
    .run();
}

/** A sandbox that still has content and has not expired, or null. */
export async function loadSandbox(db: Db, tokenHash: string, now: number): Promise<SandboxRow | null> {
  const row = await db
    .prepare(
      `SELECT token_hash AS tokenHash, content, edits, email, created_at AS createdAt, expires_at AS expiresAt
       FROM demo_sandboxes WHERE token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<SandboxRow>();
  if (!row || row.content === null || row.expiresAt <= now) return null;
  return row;
}

export function parseContent(row: SandboxRow): SandboxContent {
  return JSON.parse(row.content ?? "{}") as SandboxContent;
}

export function snapshotOf(template: Template, content: SandboxContent): ContentSnapshot {
  return { headSha: "sandbox", schema: template.schema, site: content.site, pages: content.pages };
}

/** Applies the agent's file changes ("site.json", "pages/<slug>.json", null = delete) to sandbox content. */
export function applyChanges(content: SandboxContent, changes: ContentChange[]): SandboxContent {
  const next: SandboxContent = { site: content.site, pages: { ...content.pages } };
  for (const ch of changes) {
    if (ch.path === "site.json") {
      if (ch.content !== null) next.site = JSON.parse(ch.content);
      continue;
    }
    const m = /^pages\/([a-z0-9-]+)\.json$/.exec(ch.path);
    if (!m?.[1]) continue;
    if (ch.content === null) delete next.pages[m[1]];
    else next.pages[m[1]] = JSON.parse(ch.content);
  }
  return next;
}

/** Start of the current UTC day in ms. */
export const dayStart = (now: number) => now - (now % (24 * 60 * 60_000));

export async function spentTodayMicros(db: Db, now: number): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(cost_micros), 0) AS total FROM demo_edits WHERE created_at >= ?1")
    .bind(dayStart(now))
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Clears expired content and drops rows older than KEEP_ROWS_MS. Cheap (indexed); run on new sandboxes. */
export async function cleanup(db: Db, now: number): Promise<void> {
  await db
    .prepare("UPDATE demo_sandboxes SET content = NULL WHERE content IS NOT NULL AND expires_at <= ?1")
    .bind(now)
    .run();
  await db
    .prepare("DELETE FROM demo_sandboxes WHERE created_at < ?1")
    .bind(now - KEEP_ROWS_MS)
    .run();
  await db
    .prepare("DELETE FROM demo_edits WHERE created_at < ?1")
    .bind(now - KEEP_ROWS_MS)
    .run();
}

export interface FunnelStats {
  since: number;
  /** Sandboxes started (a visitor opened the demo and passed the bot check). */
  visits: number;
  /** Sandboxes with at least one edit. */
  edited: number;
  /** Sandboxes where the visitor left an e-mail. */
  emails: number;
  edits: number;
  costMicros: number;
}

export async function funnelStats(db: Db, since: number): Promise<FunnelStats> {
  const s = await db
    .prepare(
      `SELECT COUNT(*) AS visits, COUNT(first_edit_at) AS edited, COUNT(email_at) AS emails
       FROM demo_sandboxes WHERE created_at >= ?1`,
    )
    .bind(since)
    .first<{ visits: number; edited: number; emails: number }>();
  const e = await db
    .prepare(
      "SELECT COUNT(*) AS edits, COALESCE(SUM(cost_micros), 0) AS cost FROM demo_edits WHERE created_at >= ?1",
    )
    .bind(since)
    .first<{ edits: number; cost: number }>();
  return {
    since,
    visits: s?.visits ?? 0,
    edited: s?.edited ?? 0,
    emails: s?.emails ?? 0,
    edits: e?.edits ?? 0,
    costMicros: e?.cost ?? 0,
  };
}
