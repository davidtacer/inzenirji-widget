import type { ApiResult } from "./api.ts";

/** Sandbox state returned by every /api/demo call (TASK-016). */
export interface DemoState {
  content: { site: unknown; pages: Record<string, unknown> };
  edits: number;
  limit: number;
  emailGiven: boolean;
  expiresAt: number;
}

export interface DemoEditResult extends DemoState {
  reply: string;
  changed: boolean;
  escalated: boolean;
  pages: string[];
}

export interface DemoConfig {
  turnstileSiteKey: string | null;
  freeEdits: number;
  emailEdits: number;
}

export interface DemoApi {
  config(): Promise<ApiResult<DemoConfig>>;
  start(turnstileToken: string | null): Promise<ApiResult<DemoState & { token: string }>>;
  state(token: string): Promise<ApiResult<DemoState>>;
  edit(token: string, message: string): Promise<ApiResult<DemoEditResult>>;
  reset(token: string): Promise<ApiResult<DemoState>>;
  email(token: string, email: string, website: string): Promise<ApiResult<DemoState>>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const isState = (v: unknown): v is DemoState => {
  const s = v as Partial<DemoState> | null;
  return (
    !!s &&
    typeof s.content === "object" &&
    s.content !== null &&
    typeof s.edits === "number" &&
    typeof s.limit === "number" &&
    typeof s.emailGiven === "boolean"
  );
};

/** Client for /api/demo/* (same origin as the widget). */
export function createDemoApi(fetchImpl: FetchLike = (i, init) => fetch(i, init)): DemoApi {
  const call = async <T>(
    method: "GET" | "POST",
    path: string,
    token: string | null,
    body: unknown,
    check: (v: unknown) => boolean,
  ): Promise<ApiResult<T>> => {
    let res: Response;
    try {
      res = await fetchImpl(`/api/demo/${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return { ok: false, status: 0, error: "network" };
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // no body
    }
    if (!res.ok) {
      const error = (data as { error?: unknown } | null)?.error;
      return { ok: false, status: res.status, error: typeof error === "string" ? error : "unknown" };
    }
    if (!check(data)) return { ok: false, status: res.status, error: "bad_response" };
    return { ok: true, value: data as T };
  };
  return {
    config: () =>
      call("GET", "config", null, undefined, (v) => typeof (v as DemoConfig | null)?.freeEdits === "number"),
    start: (turnstileToken) =>
      call(
        "POST",
        "start",
        null,
        { turnstileToken },
        (v) => isState(v) && typeof (v as { token?: unknown }).token === "string",
      ),
    state: (token) => call("GET", "state", token, undefined, isState),
    edit: (token, message) =>
      call(
        "POST",
        "edit",
        token,
        { message },
        (v) => isState(v) && typeof (v as { reply?: unknown }).reply === "string",
      ),
    reset: (token) => call("POST", "reset", token, {}, isState),
    email: (token, email, website) => call("POST", "email", token, { email, website }, isState),
  };
}

const KEY = "inzenirji:demo";

/** The sandbox token lives in the iframe's localStorage (partitioned per top-level site); failures are ignored. */
export const demoTokenStore = {
  load(now = Date.now()): string | null {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
      if (typeof v.token !== "string" || typeof v.expiresAt !== "number" || v.expiresAt <= now) return null;
      return v.token;
    } catch {
      return null;
    }
  },
  save(token: string, expiresAt: number) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ token, expiresAt }));
    } catch {
      // memory only
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // nothing
    }
  },
};
