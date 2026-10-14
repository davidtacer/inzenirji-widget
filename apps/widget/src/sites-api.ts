import type { ApiResult } from "./api.ts";

export interface SiteStatus {
  unpublished: number;
  previewBuild: "pending" | "success" | "failure" | "unknown";
  previewUrl: string;
  liveUrl: string;
}

export interface EditResult {
  reply: string;
  changed: boolean;
  files: string[];
  escalated: boolean;
  previewUrl: string;
  costMicros: number;
  priceCents: number;
}

export interface SitesApi {
  status(): Promise<ApiResult<SiteStatus>>;
  edit(message: string): Promise<ApiResult<EditResult>>;
  publish(): Promise<ApiResult<{ published: boolean; liveUrl: string }>>;
  undo(): Promise<ApiResult<{ undone: boolean; liveUrl: string }>>;
  discard(): Promise<ApiResult<{ discarded: boolean }>>;
}

export type SitesApiFactory = (siteId: string, sessionToken: string) => SitesApi;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Client for /api/sites/:siteId/* (same origin). Bodies are checked for the fields the UI uses. */
export function createSitesApi(fetchImpl: FetchLike = (i, init) => fetch(i, init)): SitesApiFactory {
  return (siteId, sessionToken) => {
    const call = async <T>(method: string, path: string, body?: unknown, check?: (v: unknown) => boolean) => {
      let res: Response;
      try {
        res = await fetchImpl(`/api/sites/${encodeURIComponent(siteId)}/${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        return { ok: false, status: 0, error: "network" } as const;
      }
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // no body
      }
      if (!res.ok) {
        const error = (data as { error?: unknown } | null)?.error;
        return {
          ok: false,
          status: res.status,
          error: typeof error === "string" ? error : "unknown",
        } as const;
      }
      if (check && !check(data)) return { ok: false, status: res.status, error: "bad_response" } as const;
      return { ok: true, value: data as T } as const;
    };
    const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
    return {
      status: () =>
        call<SiteStatus>("GET", "status", undefined, (v) => isObj(v) && typeof v.unpublished === "number"),
      edit: (message) =>
        call<EditResult>("POST", "edit", { message }, (v) => isObj(v) && typeof v.reply === "string"),
      publish: () => call("POST", "publish", undefined, (v) => isObj(v) && typeof v.published === "boolean"),
      undo: () => call("POST", "undo", undefined, (v) => isObj(v) && v.undone === true),
      discard: () => call("POST", "discard", undefined, (v) => isObj(v) && v.discarded === true),
    };
  };
}

/** "0,06 €" from integer cents. */
export function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)},${(cents % 100).toString().padStart(2, "0")} €`;
}
