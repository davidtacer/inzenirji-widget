import type { ExchangeResponse, Role, SessionInfo } from "@inzenirji/shared";
import { isHttpOrigin } from "@inzenirji/shared/embed-protocol";
import { randomToken, sha256Hex } from "../crypto.ts";
import type { Db } from "../db.ts";
import { loginEmail, type Mailer } from "../mailer.ts";

export const LOGIN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const LIMITS = {
  loginPerEmail: 5,
  loginPerIp: 20,
  exchangePerIp: 30,
} as const;

export interface AuthDeps {
  db: Db;
  mailer: Mailer;
  now: () => number;
}

/** Outcome of a login request, for logs/tests only. Never shown to the client (it always gets 202). */
export type LoginOutcome = "sent" | "unknown_site" | "unknown_user" | "rate_limited" | "bad_origin";

/**
 * Fixed-window counter. Returns true when the call is within `limit` for the current window.
 * One atomic upsert, so concurrent calls cannot both slip under the limit.
 */
export async function hitRateLimit(
  db: Db,
  key: string,
  limit: number,
  now: number,
  windowMs = HOUR_MS,
): Promise<boolean> {
  const expired = now - windowMs;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
       RETURNING count`,
    )
    .bind(key, now, expired)
    .first<{ count: number }>();
  return (row?.count ?? Number.POSITIVE_INFINITY) <= limit;
}

export async function requestLogin(
  deps: AuthDeps,
  input: { siteId: string; email: string; ip: string },
): Promise<LoginOutcome> {
  const { db, mailer, now } = deps;
  const t = now();
  const ipKey = `login-ip:${await sha256Hex(input.ip)}`;
  const emailKey = `login-email:${await sha256Hex(`${input.siteId}|${input.email}`)}`;
  // Count every attempt (also for unknown addresses) so probing is rate limited too.
  const ipOk = await hitRateLimit(db, ipKey, LIMITS.loginPerIp, t);
  const emailOk = await hitRateLimit(db, emailKey, LIMITS.loginPerEmail, t);
  if (!ipOk || !emailOk) return "rate_limited";

  const site = await db
    .prepare("SELECT name, origin FROM sites WHERE id = ?1")
    .bind(input.siteId)
    .first<{ name: string; origin: string }>();
  if (!site) return "unknown_site";
  if (!isHttpOrigin(site.origin)) return "bad_origin";

  const user = await db
    .prepare("SELECT role FROM site_users WHERE site_id = ?1 AND email = ?2")
    .bind(input.siteId, input.email)
    .first<{ role: Role }>();
  if (!user) return "unknown_user";

  const token = randomToken();
  await db
    .prepare(
      "INSERT INTO login_tokens (token_hash, site_id, email, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(await sha256Hex(token), input.siteId, input.email, t + LOGIN_TTL_MS, t)
    .run();

  const link = `${site.origin}/uredi#login=${token}`;
  await mailer.send({ to: input.email, ...loginEmail(site.name, link, LOGIN_TTL_MS / 60_000) });
  return "sent";
}

export type ExchangeResult =
  | { ok: true; value: ExchangeResponse; sessionToken: string }
  | { ok: false; error: "invalid_token" | "rate_limited" };

export async function exchangeToken(
  deps: Pick<AuthDeps, "db" | "now">,
  input: { siteId: string; token: string; ip: string },
): Promise<ExchangeResult> {
  const { db, now } = deps;
  const t = now();
  if (!(await hitRateLimit(db, `exchange-ip:${await sha256Hex(input.ip)}`, LIMITS.exchangePerIp, t))) {
    return { ok: false, error: "rate_limited" };
  }

  // Single use: only one caller can flip used_at from NULL.
  const used = await db
    .prepare(
      `UPDATE login_tokens SET used_at = ?1
       WHERE token_hash = ?2 AND site_id = ?3 AND used_at IS NULL AND expires_at > ?1
       RETURNING email`,
    )
    .bind(t, await sha256Hex(input.token), input.siteId)
    .first<{ email: string }>();
  if (!used) return { ok: false, error: "invalid_token" };

  const user = await db
    .prepare("SELECT role FROM site_users WHERE site_id = ?1 AND email = ?2")
    .bind(input.siteId, used.email)
    .first<{ role: Role }>();
  if (!user) return { ok: false, error: "invalid_token" };

  const sessionToken = randomToken();
  const expiresAt = t + SESSION_TTL_MS;
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, site_id, email, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(await sha256Hex(sessionToken), input.siteId, used.email, expiresAt, t)
    .run();

  return {
    ok: true,
    sessionToken,
    value: { sessionToken, expiresAt, siteId: input.siteId, email: used.email, role: user.role },
  };
}

/** Resolves a bearer session. A user removed from `site_users` loses access immediately. */
export async function getSession(
  deps: Pick<AuthDeps, "db" | "now">,
  sessionToken: string,
): Promise<SessionInfo | null> {
  const row = await deps.db
    .prepare(
      `SELECT s.site_id AS siteId, s.email AS email, u.role AS role
       FROM sessions s JOIN site_users u ON u.site_id = s.site_id AND u.email = s.email
       WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
    )
    .bind(await sha256Hex(sessionToken), deps.now())
    .first<SessionInfo>();
  return row ? { siteId: row.siteId, email: row.email, role: row.role } : null;
}

export async function deleteSession(deps: Pick<AuthDeps, "db">, sessionToken: string): Promise<void> {
  await deps.db
    .prepare("DELETE FROM sessions WHERE token_hash = ?1")
    .bind(await sha256Hex(sessionToken))
    .run();
}
