import type { ExchangeResponse, SessionInfo } from "@inzenirji/shared";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, type AppDeps } from "./App.tsx";
import type { ApiResult, AuthApi } from "./api.ts";
import { t } from "./i18n.ts";
import { readParams } from "./params.ts";
import type { SessionStore, StoredSession } from "./session-store.ts";

const SITE = "hisa-denk";
const PARENT = "https://hisa-denk.si";
const LOGIN_TOKEN = "L".repeat(43);
const SESSION = "S".repeat(43);
const OLD_SESSION = "O".repeat(43);

const exchangeOk: ApiResult<ExchangeResponse> = {
  ok: true,
  value: {
    sessionToken: SESSION,
    expiresAt: 9e12,
    siteId: SITE,
    email: "lastnik@hisa-denk.si",
    role: "owner",
  },
};
const meOk: ApiResult<SessionInfo> = {
  ok: true,
  value: { siteId: SITE, email: "lastnik@hisa-denk.si", role: "owner" },
};
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

function memoryStore(initial?: StoredSession): SessionStore & { data: Map<string, StoredSession> } {
  const data = new Map<string, StoredSession>(initial ? [[SITE, initial]] : []);
  return {
    data,
    load: (s) => data.get(s) ?? null,
    save: (s, v) => void data.set(s, v),
    clear: (s) => void data.delete(s),
  };
}

let container: HTMLElement;
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
});

function setup(opts: { stored?: StoredSession; api?: Partial<AuthApi>; search?: string } = {}) {
  const api: AuthApi = {
    requestLink: vi.fn(async () => ({ ok: true as const, value: true as const })),
    exchange: vi.fn(async () => exchangeOk),
    me: vi.fn(async () => meOk),
    logout: vi.fn(async () => ({ ok: true as const, value: true as const })),
    ...opts.api,
  };
  const store = memoryStore(opts.stored);
  const target = new EventTarget();
  const parent = { name: "client-page" } as unknown as Window;
  const win = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    parent,
  } as AppDeps["win"];
  const deps: AppDeps = { api, store, win };
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() =>
    render(
      <App
        params={readParams(opts.search ?? `?site=${SITE}&origin=${encodeURIComponent(PARENT)}`)}
        deps={deps}
      />,
      container,
    ),
  );
  const post = async (data: unknown, origin = PARENT, source: unknown = parent) => {
    await act(async () => {
      target.dispatchEvent(
        new MessageEvent("message", { data, origin, source: source as MessageEventSource }),
      );
    });
    await flush();
  };
  return { api, store, post, parent };
}

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const text = () => container.textContent ?? "";
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;

async function typeAndSubmit(value: string) {
  const input = container.querySelector<HTMLInputElement>("#email");
  if (!input) throw new Error("no email input");
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

describe("login form", () => {
  it("is shown when there is no stored session, without calling the API", () => {
    const { api } = setup();
    expect(container.querySelector("#email")).not.toBeNull();
    expect(text()).toContain(t("sl", "loginIntro"));
    expect(api.me).not.toHaveBeenCalled();
  });

  it("rejects an invalid address locally", async () => {
    const { api } = setup();
    await typeAndSubmit("ni-email");
    expect(alertText()).toBe(t("sl", "invalidEmail"));
    expect(api.requestLink).not.toHaveBeenCalled();
  });

  it("requests a link for the trimmed address and shows the neutral confirmation", async () => {
    const { api } = setup();
    await typeAndSubmit("  lastnik@hisa-denk.si ");
    expect(api.requestLink).toHaveBeenCalledWith(SITE, "lastnik@hisa-denk.si");
    expect(text()).toContain(t("sl", "linkSent"));
    const back = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === t("sl", "useAnotherEmail"),
    );
    await act(async () => back?.click());
    expect(container.querySelector("#email")).not.toBeNull();
  });

  it.each([
    ["network", fail(0, "network"), "networkError"],
    ["rate limit", fail(429, "rate_limited"), "rateLimited"],
    ["server rejects address", fail(400, "invalid_request"), "invalidEmail"],
  ] as const)("shows a message on %s", async (_name, result, key) => {
    setup({ api: { requestLink: vi.fn(async () => result) } });
    await typeAndSubmit("lastnik@hisa-denk.si");
    expect(alertText()).toBe(t("sl", key));
  });
});

describe("stored session", () => {
  const stored = { token: OLD_SESSION, expiresAt: 9e12 };

  it("is checked with the API and signs in", async () => {
    const { api } = setup({ stored });
    expect(text()).toContain(t("sl", "checking"));
    await flush();
    expect(api.me).toHaveBeenCalledWith(SITE, OLD_SESSION);
    expect(text()).toContain("lastnik@hisa-denk.si");
    expect(container.querySelector("#email")).toBeNull();
  });

  it.each([401, 403])("is cleared when the API answers %i", async (status) => {
    const { store } = setup({ stored, api: { me: vi.fn(async () => fail(status, "unauthorized")) } });
    await flush();
    expect(store.data.has(SITE)).toBe(false);
    expect(container.querySelector("#email")).not.toBeNull();
  });

  it("is kept when the server cannot be reached", async () => {
    const { store } = setup({ stored, api: { me: vi.fn(async () => fail(0, "network")) } });
    await flush();
    expect(store.data.get(SITE)).toEqual(stored);
    expect(alertText()).toBe(t("sl", "networkError"));
  });

  it("logout clears it, calls the API and shows the form", async () => {
    const { api, store } = setup({ stored });
    await flush();
    const logout = [...container.querySelectorAll("button")].find((b) => b.textContent === t("sl", "logout"));
    await act(async () => logout?.click());
    await flush();
    expect(store.data.has(SITE)).toBe(false);
    expect(api.logout).toHaveBeenCalledWith(OLD_SESSION);
    expect(container.querySelector("#email")).not.toBeNull();
  });
});

describe("login token from the embed script", () => {
  const loginMessage = { v: 1, type: "embed:login", token: LOGIN_TOKEN };

  it("is exchanged for a session that is stored", async () => {
    const { api, store, post } = setup();
    await post(loginMessage);
    expect(api.exchange).toHaveBeenCalledWith(SITE, LOGIN_TOKEN);
    expect(store.data.get(SITE)).toEqual({ token: SESSION, expiresAt: 9e12 });
    expect(text()).toContain("lastnik@hisa-denk.si");
  });

  it.each([
    ["wrong origin", "https://evil.example", undefined],
    ["wrong source window", PARENT, { name: "other" }],
  ])("is ignored from a %s", async (_name, origin, source) => {
    const { api, post, parent } = setup();
    await post(loginMessage, origin, source ?? parent);
    expect(api.exchange).not.toHaveBeenCalled();
  });

  it("ignores malformed messages", async () => {
    const { api, post } = setup();
    await post({ ...loginMessage, token: "short" });
    await post({ ...loginMessage, extra: 1 });
    await post("embed:login");
    expect(api.exchange).not.toHaveBeenCalled();
  });

  it("is ignored when the parent origin is unknown", async () => {
    const { api, post } = setup({ search: `?site=${SITE}` });
    await post(loginMessage);
    expect(api.exchange).not.toHaveBeenCalled();
  });

  it("shows 'link no longer valid' when the exchange is refused", async () => {
    const { post } = setup({ api: { exchange: vi.fn(async () => fail(401, "invalid_token")) } });
    await post(loginMessage);
    expect(alertText()).toBe(t("sl", "linkInvalid"));
  });

  it("wins over a slower stored-session check", async () => {
    let resolveMe: (v: ApiResult<SessionInfo>) => void = () => {};
    const me = vi.fn(() => new Promise<ApiResult<SessionInfo>>((r) => (resolveMe = r)));
    const { store, post } = setup({ stored: { token: OLD_SESSION, expiresAt: 9e12 }, api: { me } });
    await post(loginMessage);
    await act(async () => resolveMe(fail(401, "unauthorized"))); // old session rejected, but too late to matter
    await flush();
    expect(store.data.get(SITE)?.token).toBe(SESSION);
    expect(text()).toContain("lastnik@hisa-denk.si");
  });
});

describe("re-opening an old link while signed in", () => {
  it("keeps the valid stored session instead of showing an error", async () => {
    const { store, post } = setup({
      stored: { token: OLD_SESSION, expiresAt: 9e12 },
      api: { exchange: vi.fn(async () => fail(401, "invalid_token")) },
    });
    await flush();
    await post({ v: 1, type: "embed:login", token: LOGIN_TOKEN });
    expect(store.data.get(SITE)?.token).toBe(OLD_SESSION);
    expect(text()).toContain("lastnik@hisa-denk.si");
    expect(alertText()).toBeNull();
  });

  it("shows the link error when the stored session is no longer valid either", async () => {
    const { store, post } = setup({
      stored: { token: OLD_SESSION, expiresAt: 9e12 },
      api: {
        exchange: vi.fn(async () => fail(401, "invalid_token")),
        me: vi.fn(async () => fail(401, "unauthorized")),
      },
    });
    await post({ v: 1, type: "embed:login", token: LOGIN_TOKEN });
    expect(store.data.has(SITE)).toBe(false);
    expect(alertText()).toBe(t("sl", "linkInvalid"));
  });
});

describe("default dependencies", () => {
  it("check a stored session exactly once (no render loop)", async () => {
    localStorage.setItem(
      `inzenirji:session:${SITE}`,
      JSON.stringify({ token: OLD_SESSION, expiresAt: 9e12 }),
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ siteId: SITE, email: "lastnik@hisa-denk.si", role: "owner" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(<App params={readParams(`?site=${SITE}`)} />, container));
    for (let i = 0; i < 5; i++) await flush();
    expect(text()).toContain("lastnik@hisa-denk.si");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    localStorage.clear();
  });
});
