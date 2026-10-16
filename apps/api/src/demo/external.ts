import type { Db } from "../db.ts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Cloudflare Turnstile server-side check (one challenge per new sandbox). */
export async function verifyTurnstile(
  secretKey: string,
  token: string,
  ip: string,
  fetchImpl: FetchLike,
): Promise<boolean> {
  const body = new FormData();
  body.set("secret", secretKey);
  body.set("response", token);
  if (ip !== "unknown") body.set("remoteip", ip);
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch {
    return false;
  }
}

export interface CrmConfig {
  /** e.g. https://crm.inzenirji.si/api/leads/demo */
  url: string;
  /** Token generated in the CRM (Nastavitve → Demo urejevalnika); also protects GET /api/demo/stats. */
  token: string;
}

/**
 * Sends sandboxes with an e-mail that the CRM has not accepted yet (newest week, at most `limit` per call).
 * Each lead carries what the visitor asked for, so the owner sees their interest. Failures stay pending.
 */
export async function flushLeads(
  db: Db,
  crm: CrmConfig,
  now: number,
  fetchImpl: FetchLike,
  limit = 5,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT token_hash AS tokenHash, email, website, created_at AS createdAt, email_at AS emailAt, edits
       FROM demo_sandboxes
       WHERE email_at IS NOT NULL AND lead_sent_at IS NULL AND email_at >= ?1
       ORDER BY email_at LIMIT ?2`,
    )
    .bind(now - 7 * 24 * 60 * 60_000, limit)
    .all<{
      tokenHash: string;
      email: string;
      website: string | null;
      createdAt: number;
      emailAt: number;
      edits: number;
    }>();
  let sent = 0;
  for (const lead of results) {
    const { results: requests } = await db
      .prepare(
        "SELECT request, reply, changed, created_at AS at FROM demo_edits WHERE token_hash = ?1 ORDER BY id LIMIT 20",
      )
      .bind(lead.tokenHash)
      .all<{ request: string; reply: string; changed: number; at: number }>();
    try {
      const res = await fetchImpl(crm.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${crm.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: lead.tokenHash.slice(0, 16),
          email: lead.email,
          website: lead.website,
          startedAt: new Date(lead.createdAt).toISOString(),
          emailAt: new Date(lead.emailAt).toISOString(),
          edits: requests.map((r) => ({
            request: r.request,
            reply: r.reply,
            changed: r.changed === 1,
            at: new Date(r.at).toISOString(),
          })),
        }),
      });
      if (!res.ok) {
        console.error("[demo] crm lead refused:", res.status);
        continue;
      }
      await db
        .prepare("UPDATE demo_sandboxes SET lead_sent_at = ?1 WHERE token_hash = ?2")
        .bind(now, lead.tokenHash)
        .run();
      sent++;
    } catch {
      console.error("[demo] crm lead failed: network");
    }
  }
  return sent;
}
