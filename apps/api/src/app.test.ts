import { ErrorResponse, HealthResponse } from "@inzenirji/shared";
import { describe, expect, it } from "vitest";
import { configFromEnv, createApp } from "./app.ts";

describe("GET /api/health", () => {
  it("returns ok with the configured version", async () => {
    const res = await createApp({ version: "abc1234" }).request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({ status: "ok", version: "abc1234" });
  });
});

describe("unknown routes", () => {
  it.each(["/api/nope", "/health", "/"])("%s → 404 not_found", async (path) => {
    const res = await createApp({ version: "x" }).request(path);
    expect(res.status).toBe(404);
    expect(ErrorResponse.parse(await res.json())).toEqual({ error: "not_found" });
  });

  it("POST /api/health is not allowed (404)", async () => {
    const res = await createApp({ version: "x" }).request("/api/health", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("configFromEnv", () => {
  it.each([
    [{ GIT_SHA: "abc1234" }, "abc1234"],
    [{ GIT_SHA: "  abc1234 " }, "abc1234"],
    [{ GIT_SHA: "" }, "dev"],
    [{ GIT_SHA: "   " }, "dev"],
    [{}, "dev"],
  ])("%j → version %s", (env, version) => {
    expect(configFromEnv(env).version).toBe(version);
  });
});
