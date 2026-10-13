import type { ErrorResponse, HealthResponse } from "@inzenirji/shared";
import { Hono } from "hono";

/** Runtime configuration, read from the environment by the runtime entry (node.ts, later workers). */
export interface ApiConfig {
  /** Deployed commit SHA; "dev" when running locally. */
  version: string;
}

/**
 * Builds the API. Runtime-agnostic (Web standard Request/Response) so it can run on Node or
 * Cloudflare Workers until hosting is decided (ADR-006).
 */
export function createApp(config: ApiConfig) {
  const app = new Hono().basePath("/api");

  app.get("/health", (c) => c.json<HealthResponse>({ status: "ok", version: config.version }));

  app.notFound((c) => c.json<ErrorResponse>({ error: "not_found" }, 404));

  app.onError((err, c) => {
    // Never echo internal error details to the client.
    console.error("[api] unhandled error:", err.message);
    return c.json<ErrorResponse>({ error: "internal_error" }, 500);
  });

  return app;
}

export function configFromEnv(env: Record<string, string | undefined>): ApiConfig {
  const version = env.GIT_SHA?.trim();
  return { version: version ? version : "dev" };
}
