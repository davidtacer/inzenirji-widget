import {
  type ErrorResponse,
  ExchangeBody,
  isTokenFormat,
  LoginRequestBody,
  type SessionInfo,
} from "@inzenirji/shared";
import { isValidSiteId } from "@inzenirji/shared/site-id";
import { type Context, Hono } from "hono";
import { type AuthDeps, deleteSession, exchangeToken, getSession, requestLogin } from "./service.ts";

export interface AuthRouteDeps {
  auth: AuthDeps;
  /** Runs work after the response (Worker: ctx.waitUntil). Must not throw. */
  background: (work: Promise<unknown>) => void;
}

function clientIp(c: Context): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

/** Returns the bearer token if the header is exactly "Bearer <token>" with a well-formed token. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  return match?.[1] && isTokenFormat(match[1]) ? match[1] : null;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function authRoutes(deps: AuthRouteDeps) {
  const app = new Hono();
  const err = (c: Context, error: string, status: 400 | 401 | 403 | 429) =>
    c.json<ErrorResponse>({ error }, status);

  app.post("/request", async (c) => {
    const body = LoginRequestBody.safeParse(await readJson(c));
    if (!body.success) return err(c, "invalid_request", 400);
    const ip = clientIp(c);
    // Everything else happens after the response: same answer and timing for every address.
    deps.background(
      requestLogin(deps.auth, { ...body.data, ip }).catch((e: unknown) => {
        console.error("[auth] login request failed:", e instanceof Error ? e.name : "unknown");
      }),
    );
    return c.json({ ok: true }, 202);
  });

  app.post("/exchange", async (c) => {
    const body = ExchangeBody.safeParse(await readJson(c));
    if (!body.success) return err(c, "invalid_request", 400);
    const result = await exchangeToken(deps.auth, { ...body.data, ip: clientIp(c) });
    if (!result.ok) return err(c, result.error, result.error === "rate_limited" ? 429 : 401);
    return c.json(result.value, 200);
  });

  app.get("/me", async (c) => {
    const site = c.req.query("site");
    if (!isValidSiteId(site)) return err(c, "invalid_request", 400);
    const token = bearerToken(c.req.header("Authorization"));
    if (!token) return err(c, "unauthorized", 401);
    const session = await getSession(deps.auth, token);
    if (!session) return err(c, "unauthorized", 401);
    if (session.siteId !== site) return err(c, "wrong_site", 403);
    return c.json<SessionInfo>(session, 200);
  });

  app.post("/logout", async (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token) return err(c, "unauthorized", 401);
    await deleteSession(deps.auth, token);
    return c.body(null, 204);
  });

  return app;
}
