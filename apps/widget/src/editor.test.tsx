import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, STATUS_POLL_MS } from "./Editor.tsx";
import { t } from "./i18n.ts";
import type { EditResult, SiteStatus, SitesApi } from "./sites-api.ts";
import { createSitesApi, formatCents } from "./sites-api.ts";

const status = (over: Partial<SiteStatus> = {}): SiteStatus => ({
  unpublished: 0,
  previewBuild: "success",
  previewUrl: "https://demo-dev.inzenirji.si",
  liveUrl: "https://demo.inzenirji.si",
  ...over,
});
const editOk = (over: Partial<EditResult> = {}): EditResult => ({
  reply: "Cena je zdaj 6,50 €.",
  changed: true,
  files: ["pages/meni.json"],
  escalated: false,
  previewUrl: "https://demo-dev.inzenirji.si",
  costMicros: 55_200,
  priceCents: 6,
  ...over,
});

let container: HTMLElement;
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const text = () => container.textContent ?? "";
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;

async function setup(api: Partial<SitesApi> = {}, initial: SiteStatus = status()) {
  const full: SitesApi = {
    status: vi.fn(async () => ({ ok: true as const, value: initial })),
    edit: vi.fn(async () => ({ ok: true as const, value: editOk() })),
    publish: vi.fn(async () => ({ ok: true as const, value: { published: true, liveUrl: initial.liveUrl } })),
    undo: vi.fn(async () => ({ ok: true as const, value: { undone: true, liveUrl: initial.liveUrl } })),
    discard: vi.fn(async () => ({ ok: true as const, value: { discarded: true } })),
    ...api,
  };
  const onSessionEnded = vi.fn();
  const onLogout = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() =>
    render(
      <Editor
        lang="sl"
        email="lastnik@example.com"
        api={full}
        onLogout={onLogout}
        onSessionEnded={onSessionEnded}
      />,
      container,
    ),
  );
  await flush();
  return { api: full, onSessionEnded, onLogout };
}

async function type(value: string) {
  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    ta.value = value;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

describe("Editor", () => {
  it("shows the intro, links to the test and live site, and the publish state", async () => {
    await setup();
    expect(text()).toContain(t("sl", "editorIntro"));
    const links = [...container.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Testna stran", "https://demo-dev.inzenirji.si"],
      ["Prava stran", "https://demo.inzenirji.si"],
    ]);
    expect(text()).toContain(t("sl", "noUnpublished"));
    expect(button(t("sl", "publish"))?.disabled).toBe(true);
    expect(button(t("sl", "discard"))).toBeUndefined();
  });

  it("sends the trimmed message and shows the reply with its cost", async () => {
    const { api } = await setup();
    await type("  Bučna juha naj stane 6,50 €  ");
    await submit();
    expect(api.edit).toHaveBeenCalledWith("Bučna juha naj stane 6,50 €");
    expect(text()).toContain("Bučna juha naj stane 6,50 €");
    expect(text()).toContain("Cena je zdaj 6,50 €.");
    expect(text()).toContain("Strošek: 0,06 €");
    expect(api.status).toHaveBeenCalledTimes(2); // on open and after the change
  });

  it("Enter sends, Shift+Enter does not; empty messages are not sent", async () => {
    const { api } = await setup();
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await type("   ");
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(api.edit).not.toHaveBeenCalled();
    await type("vrstica");
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });
    expect(api.edit).not.toHaveBeenCalled();
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect(api.edit).toHaveBeenCalledWith("vrstica");
  });

  it("marks answers without changes and escalations", async () => {
    const edit = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: editOk({ changed: false, reply: "Katero ceno?", priceCents: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: editOk({ changed: false, escalated: true, reply: "To ni mogoče." }),
      });
    await setup({ edit });
    await type("cena");
    await submit();
    await type("trgovina");
    await submit();
    expect(text()).toContain(`${t("sl", "noChange")} · Strošek: 0,01 €`);
    expect(text()).toContain(t("sl", "escalated"));
  });

  it.each([
    [503, "agent_unavailable", "errAgentUnavailable"],
    [404, "site_not_connected", "errNotConnected"],
    [409, "conflict", "errConflict"],
    [429, "rate_limited", "rateLimited"],
    [502, "github_unavailable", "errGithub"],
    [0, "network", "networkError"],
  ] as const)("edit error %i %s → message", async (statusCode, error, key) => {
    await setup({
      edit: vi.fn(async () => ({ ok: false as const, status: statusCode, error })) as SitesApi["edit"],
    });
    await type("x");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t("sl", key));
  });

  it("401 ends the session", async () => {
    const { onSessionEnded } = await setup({
      edit: vi.fn(async () => ({
        ok: false as const,
        status: 401,
        error: "unauthorized",
      })) as SitesApi["edit"],
    });
    await type("x");
    await submit();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
  });

  it("publish asks for confirmation, then publishes", async () => {
    const { api } = await setup({}, status({ unpublished: 2 }));
    expect(text()).toContain("Neobjavljene spremembe: 2");
    await act(async () => button(t("sl", "publish"))?.click());
    expect(api.publish).not.toHaveBeenCalled();
    await act(async () => button(t("sl", "confirmPublish"))?.click());
    await flush();
    expect(api.publish).toHaveBeenCalledTimes(1);
    expect(text()).toContain(t("sl", "published"));
  });

  it("cancel keeps everything as it was", async () => {
    const { api } = await setup({}, status({ unpublished: 1 }));
    await act(async () => button(t("sl", "discard"))?.click());
    await act(async () => button(t("sl", "cancel"))?.click());
    expect(api.discard).not.toHaveBeenCalled();
    expect(button(t("sl", "discard"))).toBeDefined();
  });

  it("undo with nothing to undo shows a message", async () => {
    const { api } = await setup({
      undo: vi.fn(async () => ({
        ok: false as const,
        status: 409,
        error: "nothing_to_undo",
      })) as SitesApi["undo"],
    });
    await act(async () => button(t("sl", "undo"))?.click());
    await act(async () => button(t("sl", "confirmUndo"))?.click());
    await flush();
    expect(api.undo).toHaveBeenCalledTimes(1);
    expect(text()).toContain(t("sl", "nothingToUndo"));
  });

  it(`polls the status every ${STATUS_POLL_MS / 1000} s while the test site is being prepared`, async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const statusFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: status({ previewBuild: "pending", unpublished: 1 }) })
      .mockResolvedValueOnce({ ok: true, value: status({ previewBuild: "success", unpublished: 1 }) });
    container = document.createElement("div");
    document.body.appendChild(container);
    const api: SitesApi = {
      status: statusFn,
      edit: vi.fn(),
      publish: vi.fn(),
      undo: vi.fn(),
      discard: vi.fn(),
    };
    await act(async () => {
      render(
        <Editor lang="sl" email="a@b.si" api={api} onLogout={() => {}} onSessionEnded={() => {}} />,
        container,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(text()).toContain(t("sl", "buildPending"));
    await act(async () => {
      vi.advanceTimersByTime(STATUS_POLL_MS);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(statusFn).toHaveBeenCalledTimes(2);
    expect(text()).toContain(t("sl", "buildReady"));
    await act(async () => {
      vi.advanceTimersByTime(STATUS_POLL_MS * 3);
    });
    expect(statusFn).toHaveBeenCalledTimes(2); // no polling once ready
  });
});

describe("createSitesApi", () => {
  it("calls the site routes with the bearer token", async () => {
    const f = vi.fn(
      async (_i: string, _init?: RequestInit) => new Response(JSON.stringify(editOk()), { status: 200 }),
    );
    const api = createSitesApi(f)("demo", "S".repeat(43));
    const res = await api.edit("6,50");
    expect(res.ok).toBe(true);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe("/api/sites/demo/edit");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${"S".repeat(43)}`);
    expect(JSON.parse(String(init?.body))).toEqual({ message: "6,50" });
  });

  it("maps errors and bad bodies", async () => {
    const err = createSitesApi(
      async () => new Response(JSON.stringify({ error: "conflict" }), { status: 409 }),
    );
    expect(await err("demo", "x").edit("a")).toEqual({ ok: false, status: 409, error: "conflict" });
    const bad = createSitesApi(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    expect(await bad("demo", "x").status()).toEqual({ ok: false, status: 200, error: "bad_response" });
    const net = createSitesApi(async () => {
      throw new TypeError("offline");
    });
    expect(await net("demo", "x").publish()).toEqual({ ok: false, status: 0, error: "network" });
  });

  it.each([
    [0, "0,00 €"],
    [6, "0,06 €"],
    [1234, "12,34 €"],
  ])("formatCents(%i) = %s", (c, s) => {
    expect(formatCents(c)).toBe(s);
  });
});
