import type { ApiResult } from "./api.ts";

export type BuildState = "pending" | "success" | "failure" | "unknown";

export interface SiteStatus {
  /** Prepaid credit and the expected price of the next edit, cents incl. VAT (ADR-014). */
  balanceCents: number;
  estimateCents: number;
  /** Top-up packages; empty when payments are not available. */
  packagesCents: number[];
  unpublished: number;
  /** Commit the test site is (being) built from, and the state of that build. */
  previewSha: string;
  previewBuild: BuildState;
  /** Commit the live site is (being) built from, and the state of that build. */
  liveSha: string;
  liveBuild: BuildState;
  previewUrl: string;
  liveUrl: string;
}

export interface EditResult {
  reply: string;
  changed: boolean;
  /** Commit on the test branch with this change (null when nothing changed). */
  commitSha: string | null;
  files: string[];
  /** URLs of attached images that were used (and committed). */
  images?: string[];
  /** Credit after this edit was charged. */
  balanceCents?: number;
  escalated: boolean;
  previewUrl: string;
  costMicros: number;
  priceCents: number;
}

export interface SitesApi {
  status(): Promise<ApiResult<SiteStatus>>;
  /** Images are sent as multipart/form-data (already resized by the widget). */
  edit(message: string, images?: Array<{ blob: Blob; name: string }>): Promise<ApiResult<EditResult>>;
  publish(): Promise<ApiResult<{ published: boolean; sha: string | null; liveUrl: string }>>;
  undo(): Promise<ApiResult<{ undone: boolean; sha: string; liveUrl: string }>>;
  discard(): Promise<ApiResult<{ discarded: boolean }>>;
  /** Starts a Stripe Checkout for a credit package; returns the payment page URL. */
  checkout(amountCents: number): Promise<ApiResult<{ url: string }>>;
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
            ...(body === undefined || body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
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
      edit: (message, images = []) => {
        let body: unknown = { message };
        if (images.length) {
          const form = new FormData();
          form.set("message", message);
          for (const img of images)
            form.append("images", new File([img.blob], img.name, { type: img.blob.type || "image/jpeg" }));
          body = form;
        }
        return call<EditResult>("POST", "edit", body, (v) => isObj(v) && typeof v.reply === "string");
      },
      publish: () => call("POST", "publish", undefined, (v) => isObj(v) && typeof v.published === "boolean"),
      undo: () => call("POST", "undo", undefined, (v) => isObj(v) && v.undone === true),
      discard: () => call("POST", "discard", undefined, (v) => isObj(v) && v.discarded === true),
      checkout: (amountCents) =>
        call<{ url: string }>(
          "POST",
          "checkout",
          { amountCents },
          (v) => isObj(v) && typeof v.url === "string" && v.url.startsWith("https://checkout.stripe.com/"),
        ),
    };
  };
}

/** "0,06 €" from integer cents (negative: "−0,05 €"). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${(abs % 100).toString().padStart(2, "0")} €`;
}
