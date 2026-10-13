import { ExchangeResponse, SessionInfo } from "@inzenirji/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.ts";
import type { MailMessage } from "../mailer.ts";
import { createTestDb, seedSite } from "../testing/sqlite-d1.ts";
import { LIMITS, LOGIN_TTL_MS, SESSION_TTL_MS } from "./service.ts";

const SITE = { id: "hisa-denk", name: "Hiša Denk", origin: "https://hisa-denk.si" };
const OTHER = { id: "kavarna-trust", name: "Kavarna Trust", origin: "https://kavarnatrust.si" };
const OWNER = "lastnik@hisa-denk.si";
const T0 = 1_760_000_000_000;

function setup() {
  const db = createTestDb();
  seedSite(db, SITE, [{ email: OWNER, role: "owner" }]);
  seedSite(db, OTHER, [{ email: "ana@kavarnatrust.si", role: "owner" }]);
  const sent: MailMessage[] = [];
  const pending: Promise<unknown>[] = [];
  let now = T0;
  const app = createApp({
    version: "test",
    auth: {
      auth: { db, mailer: { send: async (m) => void sent.push(m) }, now: () => now },
      background: (p) => void pending.push(p),
    },
  });
  const call = (path: string, init: RequestInit & { ip?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.7");
    if (init.body) headers.set("Content-Type", "application/json");
    return app.request(path, { ...init, headers });
  };
  const flush = async () => {
    await Promise.all(pending.splice(0));
  };
  const requestLink = async (email = OWNER, siteId = SITE.id, ip?: string) => {
    const res = await call("/api/auth/request", {
      method: "POST",
      body: JSON.stringify({ siteId, email }),
      ...(ip ? { ip } : {}),
    });
    await flush();
    return res;
  };
  const tokenFrom = (mail: MailMessage | undefined) => {
    const m = /#login=([A-Za-z0-9_-]{43})/.exec(mail?.text ?? "");
    if (!m?.[1]) throw new Error("no login link in mail");
    return m[1];
  };
  const exchange = (token: string, siteId = SITE.id) =>
    call("/api/auth/exchange", { method: "POST", body: JSON.stringify({ siteId, token }) });
  const me = (session: string | null, site = SITE.id) =>
    call(`/api/auth/me?site=${site}`, session ? { headers: { Authorization: `Bearer ${session}` } } : {});
  const login = async () => {
    await requestLink();
    const res = await exchange(tokenFrom(sent.at(-1)));
    return ExchangeResponse.parse(await res.json());
  };
  return {
    db,
    sent,
    call,
    requestLink,
    tokenFrom,
    exchange,
    me,
    login,
    setNow: (t: number) => {
      now = t;
    },
  };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  const capture = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
});
afterEach(() => {
  // No e-mail address or token may ever reach the logs.
  for (const line of logs) {
    expect(line).not.toMatch(/@/);
    expect(line).not.toMatch(/[A-Za-z0-9_-]{43}/);
  }
  vi.restoreAllMocks();
});

describe("POST /api/auth/request", () => {
  it("sends one Slovenian login mail with a link to the client's /uredi page", async () => {
    const t = setup();
    const res = await t.requestLink();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(t.sent).toHaveLength(1);
    const mail = t.sent[0];
    expect(mail?.to).toBe(OWNER);
    expect(mail?.subject).toBe("Prijava v urejevalnik – Hiša Denk");
    expect(mail?.text).toMatch(/^https:\/\/hisa-denk\.si\/uredi#login=[A-Za-z0-9_-]{43}$/m);
    expect(mail?.html).toContain("Hiša Denk");
  });

  it("normalises the e-mail (case, spaces)", async () => {
    const t = setup();
    await t.requestLink("  Lastnik@Hisa-Denk.SI ");
    expect(t.sent).toHaveLength(1);
  });

  it("stores only a hash of the link token", async () => {
    const t = setup();
    await t.requestLink();
    const token = t.tokenFrom(t.sent[0]);
    const rows = t.db.raw.prepare("SELECT token_hash FROM login_tokens").all() as Array<{
      token_hash: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.token_hash).not.toContain(token);
  });

  it.each([
    ["unknown e-mail", "tujec@example.com", SITE.id],
    ["unknown site", OWNER, "ni-take-strani"],
    ["user of another site", "ana@kavarnatrust.si", SITE.id],
  ])("%s → same 202, no mail", async (_name, email, siteId) => {
    const t = setup();
    const res = await t.requestLink(email, siteId);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(t.sent).toHaveLength(0);
  });

  it(`sends at most ${LIMITS.loginPerEmail} mails per hour per site+e-mail, then again after the window`, async () => {
    const t = setup();
    for (let i = 0; i < LIMITS.loginPerEmail + 1; i++) {
      expect((await t.requestLink(OWNER, SITE.id, `198.51.100.${i}`)).status).toBe(202);
    }
    expect(t.sent).toHaveLength(LIMITS.loginPerEmail);
    t.setNow(T0 + 60 * 60 * 1000); // window boundary: the old window has expired
    await t.requestLink(OWNER, SITE.id, "198.51.100.200");
    expect(t.sent).toHaveLength(LIMITS.loginPerEmail + 1);
  });

  it(`limits one IP to ${LIMITS.loginPerIp} requests per hour, also for unknown addresses`, async () => {
    const t = setup();
    for (let i = 0; i < LIMITS.loginPerIp; i++) await t.requestLink(`probe${i}@example.com`);
    await t.requestLink(OWNER); // 21st from the same IP
    expect(t.sent).toHaveLength(0);
  });

  it.each([
    ["no body", undefined],
    ["not json", "nope"],
    ["bad e-mail", JSON.stringify({ siteId: SITE.id, email: "ni-email" })],
    ["bad site id", JSON.stringify({ siteId: "Hisa Denk", email: OWNER })],
    ["extra field", JSON.stringify({ siteId: SITE.id, email: OWNER, role: "owner" })],
  ])("%s → 400", async (_name, body) => {
    const t = setup();
    const res = await t.call("/api/auth/request", { method: "POST", ...(body ? { body } : {}) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(t.sent).toHaveLength(0);
  });
});

describe("POST /api/auth/exchange", () => {
  it("turns a valid link into a 30-day session for that site", async () => {
    const t = setup();
    await t.requestLink();
    const res = await t.exchange(t.tokenFrom(t.sent[0]));
    expect(res.status).toBe(200);
    const body = ExchangeResponse.parse(await res.json());
    expect(body).toMatchObject({
      siteId: SITE.id,
      email: OWNER,
      role: "owner",
      expiresAt: T0 + SESSION_TTL_MS,
    });
  });

  it("is single use", async () => {
    const t = setup();
    await t.requestLink();
    const token = t.tokenFrom(t.sent[0]);
    expect((await t.exchange(token)).status).toBe(200);
    const again = await t.exchange(token);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "invalid_token" });
  });

  it("is valid until 1 ms before expiry, not at expiry", async () => {
    const t = setup();
    await t.requestLink();
    await t.requestLink();
    const [a, b] = [t.tokenFrom(t.sent[0]), t.tokenFrom(t.sent[1])];
    t.setNow(T0 + LOGIN_TTL_MS - 1);
    expect((await t.exchange(a)).status).toBe(200);
    t.setNow(T0 + LOGIN_TTL_MS);
    expect((await t.exchange(b)).status).toBe(401);
  });

  it("rejects a link used on another site", async () => {
    const t = setup();
    await t.requestLink();
    expect((await t.exchange(t.tokenFrom(t.sent[0]), OTHER.id)).status).toBe(401);
  });

  it("rejects a link of a user removed after it was sent", async () => {
    const t = setup();
    await t.requestLink();
    t.db.raw.prepare("DELETE FROM site_users WHERE email = ?").run(OWNER);
    expect((await t.exchange(t.tokenFrom(t.sent[0]))).status).toBe(401);
  });

  it("rejects an unknown but well-formed token", async () => {
    const t = setup();
    expect((await t.exchange("A".repeat(43))).status).toBe(401);
  });

  it.each([
    ["short token", "A".repeat(42)],
    ["long token", "A".repeat(44)],
    ["bad chars", `${"A".repeat(42)}=`],
  ])("%s → 400", async (_name, token) => {
    const t = setup();
    expect((await t.exchange(token)).status).toBe(400);
  });

  it(`allows ${LIMITS.exchangePerIp} attempts per hour per IP, then 429`, async () => {
    const t = setup();
    for (let i = 0; i < LIMITS.exchangePerIp; i++)
      expect((await t.exchange("B".repeat(43))).status).toBe(401);
    const res = await t.exchange("B".repeat(43));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });
});

describe("GET /api/auth/me and POST /api/auth/logout", () => {
  it("returns the session for its own site", async () => {
    const t = setup();
    const { sessionToken } = await t.login();
    const res = await t.me(sessionToken);
    expect(res.status).toBe(200);
    expect(SessionInfo.parse(await res.json())).toEqual({ siteId: SITE.id, email: OWNER, role: "owner" });
  });

  it("refuses the session on another site with 403", async () => {
    const t = setup();
    const { sessionToken } = await t.login();
    const res = await t.me(sessionToken, OTHER.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "wrong_site" });
  });

  it.each([
    ["no header", null],
    ["unknown token", "C".repeat(43)],
  ])("%s → 401", async (_name, token) => {
    const t = setup();
    expect((await t.me(token)).status).toBe(401);
  });

  it("rejects malformed Authorization headers", async () => {
    const t = setup();
    const { sessionToken } = await t.login();
    for (const header of [
      sessionToken,
      `bearer ${sessionToken}`,
      `Bearer  ${sessionToken}`,
      `Bearer ${sessionToken}x`,
    ]) {
      const res = await t.call(`/api/auth/me?site=${SITE.id}`, { headers: { Authorization: header } });
      expect(res.status).toBe(401);
    }
  });

  it("expires after 30 days", async () => {
    const t = setup();
    const { sessionToken } = await t.login();
    t.setNow(T0 + SESSION_TTL_MS - 1);
    expect((await t.me(sessionToken)).status).toBe(200);
    t.setNow(T0 + SESSION_TTL_MS);
    expect((await t.me(sessionToken)).status).toBe(401);
  });

  it("stops working as soon as the user is removed from the site", async () => {
    const t = setup();
    const { sessionToken } = await t.login();
    t.db.raw.prepare("DELETE FROM site_users WHERE email = ?").run(OWNER);
    expect((await t.me(sessionToken)).status).toBe(401);
  });

  it("logout deletes the session", async () => {
    const t = setup();
    const { sessionToken } = await t.login();
    const res = await t.call("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(res.status).toBe(204);
    expect((await t.me(sessionToken)).status).toBe(401);
    expect(t.db.raw.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });
});

describe("failures in the background", () => {
  it("a failing mailer still answers 202 and logs no address", async () => {
    const db = createTestDb();
    seedSite(db, SITE, [{ email: OWNER, role: "owner" }]);
    const pending: Promise<unknown>[] = [];
    const app = createApp({
      version: "test",
      auth: {
        auth: {
          db,
          mailer: {
            send: async (m) => {
              throw new Error(`SMTP 550 rejected ${m.to}`);
            },
          },
          now: () => T0,
        },
        background: (p) => void pending.push(p),
      },
    });
    const res = await app.request("/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: SITE.id, email: OWNER }),
    });
    await Promise.all(pending);
    expect(res.status).toBe(202);
    expect(logs).toEqual(["[auth] login request failed: Error"]);
  });
});

describe("without auth dependencies", () => {
  it("answers 503 auth_unavailable", async () => {
    const res = await createApp({ version: "x" }).request("/api/auth/me?site=abc");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_unavailable" });
  });
});
