import { describe, expect, it, vi } from "vitest";
import { createAuthApi } from "./api.ts";
import { createSessionStore } from "./session-store.ts";

const TOKEN = "S".repeat(43);

function fakeFetch(status: number, body?: unknown) {
  return vi.fn(
    async (_input: string, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
}

describe("createAuthApi", () => {
  it("requestLink posts JSON and treats 202 as success", async () => {
    const f = fakeFetch(202, { ok: true });
    const res = await createAuthApi(f).requestLink("hisa-denk", "a@b.si");
    expect(res).toEqual({ ok: true, value: true });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/request");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ siteId: "hisa-denk", email: "a@b.si" });
  });

  it("returns the API error code and status", async () => {
    const res = await createAuthApi(fakeFetch(429, { error: "rate_limited" })).exchange("hisa-denk", TOKEN);
    expect(res).toEqual({ ok: false, status: 429, error: "rate_limited" });
  });

  it("maps a thrown fetch to a network error", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await createAuthApi(f).me("hisa-denk", TOKEN)).toEqual({ ok: false, status: 0, error: "network" });
  });

  it("rejects a 200 with an unexpected body", async () => {
    const res = await createAuthApi(fakeFetch(200, { siteId: "hisa-denk" })).me("hisa-denk", TOKEN);
    expect(res).toEqual({ ok: false, status: 200, error: "bad_response" });
  });

  it("me sends the bearer token and the site", async () => {
    const f = fakeFetch(200, { siteId: "hisa-denk", email: "a@b.si", role: "owner" });
    const res = await createAuthApi(f).me("hisa-denk", TOKEN);
    expect(res.ok).toBe(true);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/me?site=hisa-denk");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("logout treats 204 as success", async () => {
    expect(await createAuthApi(fakeFetch(204)).logout(TOKEN)).toEqual({ ok: true, value: true });
  });
});

describe("createSessionStore", () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k) => m.get(k) ?? null,
      key: (i) => [...m.keys()][i] ?? null,
      removeItem: (k) => void m.delete(k),
      setItem: (k, v) => void m.set(k, v),
    };
  }

  it("saves and loads a session per site", () => {
    const storage = memoryStorage();
    const store = createSessionStore(
      () => storage,
      () => 1000,
    );
    store.save("hisa-denk", { token: TOKEN, expiresAt: 2000 });
    expect(store.load("hisa-denk")).toEqual({ token: TOKEN, expiresAt: 2000 });
    expect(store.load("kavarna-trust")).toBeNull();
  });

  it("drops a session at its expiry time", () => {
    const storage = memoryStorage();
    let now = 1999;
    const store = createSessionStore(
      () => storage,
      () => now,
    );
    store.save("hisa-denk", { token: TOKEN, expiresAt: 2000 });
    expect(store.load("hisa-denk")).not.toBeNull();
    now = 2000;
    expect(store.load("hisa-denk")).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("drops malformed entries", () => {
    const storage = memoryStorage();
    storage.setItem("inzenirji:session:hisa-denk", '{"token":"short","expiresAt":9e12}');
    expect(createSessionStore(() => storage).load("hisa-denk")).toBeNull();
    storage.setItem("inzenirji:session:hisa-denk", "not json");
    expect(createSessionStore(() => storage).load("hisa-denk")).toBeNull();
  });

  it("works without storage (blocked or throwing)", () => {
    const throwing = createSessionStore(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => throwing.save("hisa-denk", { token: TOKEN, expiresAt: 9e12 })).not.toThrow();
    expect(throwing.load("hisa-denk")).toBeNull();
    expect(() => throwing.clear("hisa-denk")).not.toThrow();
  });
});
