import { HealthResponse } from "@inzenirji/shared";
import { describe, expect, it } from "vitest";
import worker from "./worker.ts";

describe("worker entry", () => {
  it("serves /api/health with the deployed GIT_SHA", async () => {
    const res = await worker.fetch(new Request("https://uredi-dev.inzenirji.si/api/health"), {
      GIT_SHA: "0123abc",
    });
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({ status: "ok", version: "0123abc" });
  });

  it("falls back to version 'dev' without GIT_SHA", async () => {
    const res = await worker.fetch(new Request("https://uredi-dev.inzenirji.si/api/health"), {});
    expect(HealthResponse.parse(await res.json()).version).toBe("dev");
  });
});
