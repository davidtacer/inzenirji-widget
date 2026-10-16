import { HealthResponse } from "@inzenirji/shared";
import { describe, expect, it } from "vitest";
import worker, { demoFromEnv, selectMailer } from "./worker.ts";

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

describe("selectMailer", () => {
  const smtp = {
    MAIL_TRANSPORT: "smtp",
    SMTP_HOST: "mail.example.com",
    SMTP_PORT: "465",
    SMTP_USER: "u@example.com",
    SMTP_PASSWORD: "x",
    MAIL_FROM: "u@example.com",
  };

  it("uses SMTP when fully configured", () => {
    expect(selectMailer(smtp, "https://uredi-dev.inzenirji.si/api/auth/request")).not.toBeNull();
  });

  it.each(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"] as const)(
    "returns null when %s is missing",
    (key) => {
      const env = { ...smtp, [key]: undefined };
      expect(selectMailer(env, "https://uredi-dev.inzenirji.si/")).toBeNull();
    },
  );

  it.each(["http://localhost:8787/api", "http://127.0.0.1:8787/api"])(
    "allows the console transport on %s",
    (url) => {
      expect(selectMailer({ MAIL_TRANSPORT: "console" }, url)).not.toBeNull();
    },
  );

  it.each(["https://uredi-dev.inzenirji.si/api", "https://localhost.evil.example/api"])(
    "refuses the console transport on %s",
    (url) => {
      expect(selectMailer({ MAIL_TRANSPORT: "console" }, url)).toBeNull();
    },
  );

  it("refuses unknown transports", () => {
    expect(selectMailer({ MAIL_TRANSPORT: "sendgrid" }, "http://localhost/")).toBeNull();
  });
});

describe("worker without DB", () => {
  it("answers auth routes with 503", async () => {
    const res = await worker.fetch(
      new Request("https://x.si/api/auth/me?site=abc"),
      {},
      { waitUntil: () => {} },
    );
    expect(res.status).toBe(503);
  });
});

describe("demoFromEnv (TASK-016)", () => {
  it("needs an API key and uses Haiku, 20 € a day, no captcha or CRM by default", () => {
    expect(demoFromEnv({})).toBeNull();
    const d = demoFromEnv({ ANTHROPIC_API_KEY: "k" });
    expect(d).toMatchObject({
      model: "claude-haiku-5-5",
      dailyCapMicros: 20_000_000,
      turnstile: null,
      crm: null,
    });
  });

  it("enables Turnstile and the CRM only with both values", () => {
    const base = { ANTHROPIC_API_KEY: "k", DEMO_DAILY_CAP_EUR: "5" };
    expect(demoFromEnv({ ...base, TURNSTILE_SITE_KEY: "s" })?.turnstile).toBeNull();
    const d = demoFromEnv({
      ...base,
      TURNSTILE_SITE_KEY: "s",
      TURNSTILE_SECRET_KEY: "t",
      CRM_LEADS_URL: "https://crm/x",
      CRM_LEADS_TOKEN: "c",
    });
    expect(d).toMatchObject({
      dailyCapMicros: 5_000_000,
      turnstile: { siteKey: "s", secretKey: "t" },
      crm: { url: "https://crm/x", token: "c" },
    });
    expect(demoFromEnv({ ...base, DEMO_MODEL: "gpt" })).toBeNull();
  });
});
