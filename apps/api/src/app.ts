import type { ErrorResponse, HealthResponse } from "@inzenirji/shared";
import { Hono } from "hono";
import { type AuthRouteDeps, authRoutes } from "./auth/routes.ts";
import { type SiteRouteDeps, siteRoutes } from "./sites/routes.ts";

/** Runtime configuration, read from the Worker environment (worker.ts). */
export interface ApiConfig {
  /** Deployed commit SHA; "dev" when running locally. */
  version: string;
}

export interface AppDeps extends ApiConfig {
  /** Auth needs a database and a mailer; without them /api/auth/* answers 503. */
  auth?: AuthRouteDeps;
  /** Content operations (status, publish, undo, discard, edit); without them /api/sites/* answers 503. */
  sites?: SiteRouteDeps;
}

export function createApp(deps: AppDeps) {
  const app = new Hono().basePath("/api");

  app.get("/health", (c) => c.json<HealthResponse>({ status: "ok", version: deps.version }));

  if (deps.auth) {
    app.route("/auth", authRoutes(deps.auth));
  } else {
    app.all("/auth/*", (c) => c.json<ErrorResponse>({ error: "auth_unavailable" }, 503));
  }

  if (deps.sites) {
    app.route("/sites", siteRoutes(deps.sites));
  } else {
    app.all("/sites/*", (c) => c.json<ErrorResponse>({ error: "sites_unavailable" }, 503));
  }

  app.notFound((c) => c.json<ErrorResponse>({ error: "not_found" }, 404));

  app.onError((err, c) => {
    // Never echo internal error details to the client; never log request bodies (they hold e-mails/tokens).
    console.error("[api] unhandled error:", err.name);
    return c.json<ErrorResponse>({ error: "internal_error" }, 500);
  });

  return app;
}

export function configFromEnv(env: Record<string, string | undefined>): ApiConfig {
  const version = env.GIT_SHA?.trim();
  return { version: version ? version : "dev" };
}
