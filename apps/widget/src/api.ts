import { ExchangeResponse, SessionInfo } from "@inzenirji/shared";

/** Result of an API call. `network` = no response (offline, DNS, CORS); `error` carries the API error code. */
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string }
  | { ok: false; status: 0; error: "network" };

export interface AuthApi {
  requestLink(siteId: string, email: string): Promise<ApiResult<true>>;
  exchange(siteId: string, token: string): Promise<ApiResult<ExchangeResponse>>;
  me(siteId: string, sessionToken: string): Promise<ApiResult<SessionInfo>>;
  logout(sessionToken: string): Promise<ApiResult<true>>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function errorOf(res: Response): Promise<{ ok: false; status: number; error: string }> {
  let error = "unknown";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") error = body.error;
  } catch {
    // keep "unknown"
  }
  return { ok: false, status: res.status, error };
}

/** Same-origin API client (the widget is served from the API's origin). */
export function createAuthApi(
  fetchImpl: FetchLike = (i, init) => fetch(i, init),
  base = "/api/auth",
): AuthApi {
  const send = async (path: string, init: RequestInit): Promise<Response | null> => {
    try {
      return await fetchImpl(`${base}${path}`, init);
    } catch {
      return null;
    }
  };
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const network = { ok: false, status: 0, error: "network" } as const;

  return {
    async requestLink(siteId, email) {
      const res = await send("/request", json({ siteId, email }));
      if (!res) return network;
      return res.status === 202 ? { ok: true, value: true } : errorOf(res);
    },
    async exchange(siteId, token) {
      const res = await send("/exchange", json({ siteId, token }));
      if (!res) return network;
      if (!res.ok) return errorOf(res);
      const parsed = ExchangeResponse.safeParse(await res.json().catch(() => null));
      return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, status: res.status, error: "bad_response" };
    },
    async me(siteId, sessionToken) {
      const res = await send(`/me?site=${encodeURIComponent(siteId)}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res) return network;
      if (!res.ok) return errorOf(res);
      const parsed = SessionInfo.safeParse(await res.json().catch(() => null));
      return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, status: res.status, error: "bad_response" };
    },
    async logout(sessionToken) {
      const res = await send("/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res) return network;
      return res.status === 204 ? { ok: true, value: true } : errorOf(res);
    },
  };
}
