import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEPLOY_SLOW_MS, Editor, MAX_ATTACHMENTS, STATUS_POLL_MS } from "./Editor.tsx";
import { t } from "./i18n.ts";
import type { EditResult, SiteStatus, SitesApi } from "./sites-api.ts";
import { createSitesApi, formatCents } from "./sites-api.ts";

const status = (over: Partial<SiteStatus> = {}): SiteStatus => ({
  balanceCents: 189,
  estimateCents: 11,
  packagesCents: [1000, 2500, 5000],
  unpublished: 0,
  previewSha: "dev0",
  previewBuild: "success",
  liveSha: "main0",
  liveBuild: "success",
  previewUrl: "https://demo-dev.inzenirji.si",
  liveUrl: "https://demo.inzenirji.si",
  ...over,
});
const editOk = (over: Partial<EditResult> = {}): EditResult => ({
  reply: "Cena je zdaj 6,50 €.",
  changed: true,
  commitSha: "dev1",
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

/** Stand-in for the canvas resize (happy-dom has no canvas): "resizes" to a 3-byte JPEG. */
const fakePrepare = vi.fn(async (file: File) => ({
  blob: new Blob([new Uint8Array([1, 2, 3])]),
  name: `${file.name}.jpg`,
}));

async function setup(api: Partial<SitesApi> = {}, initial: SiteStatus = status()) {
  const full: SitesApi = {
    status: vi.fn(async () => ({ ok: true as const, value: initial })),
    edit: vi.fn(async () => ({ ok: true as const, value: editOk() })),
    publish: vi.fn(async () => ({
      ok: true as const,
      value: { published: true, sha: "main1", liveUrl: initial.liveUrl },
    })),
    undo: vi.fn(async () => ({
      ok: true as const,
      value: { undone: true, sha: "main2", liveUrl: initial.liveUrl },
    })),
    discard: vi.fn(async () => ({ ok: true as const, value: { discarded: true } })),
    checkout: vi.fn(async () => ({
      ok: true as const,
      value: { url: "https://checkout.stripe.com/c/pay/cs_1" },
    })),
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
        prepareUpload={fakePrepare}
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
    expect(api.edit).toHaveBeenCalledWith("Bučna juha naj stane 6,50 €", []);
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
    expect(api.edit).toHaveBeenCalledWith("vrstica", []);
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
    [503, "site_schema_invalid", "errNotConnected"],
    [503, "github_not_installed", "errNotConnected"],
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
    expect(text()).toContain(t("sl", "publishDeploying"));
    expect(text()).not.toContain(t("sl", "publishReady"));
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
      checkout: vi.fn(),
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

async function pick(...names: string[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const files = names.map((n) => new File([new Uint8Array([9])], n, { type: "image/jpeg" }));
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

describe("Editor: credit (TASK-009)", () => {
  async function render2(
    api: Partial<SitesApi> = {},
    tab: unknown = { location: { href: "" }, close: vi.fn() },
  ) {
    const openTab = vi.fn(() => tab as Window | null);
    const full: SitesApi = {
      status: vi.fn(async () => ({ ok: true as const, value: status() })),
      edit: vi.fn(async () => ({ ok: true as const, value: editOk({ balanceCents: 178 }) })),
      publish: vi.fn(),
      undo: vi.fn(),
      discard: vi.fn(),
      checkout: vi.fn(async () => ({
        ok: true as const,
        value: { url: "https://checkout.stripe.com/c/pay/cs_1" },
      })),
      ...api,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() =>
      render(
        <Editor
          lang="sl"
          email="a@b.si"
          api={full}
          onLogout={() => {}}
          onSessionEnded={() => {}}
          openTab={openTab}
        />,
        container,
      ),
    );
    await flush();
    return { api: full, openTab, tab };
  }

  it("shows the credit and the estimate for the next change", async () => {
    await render2();
    expect(text()).toContain("Dobroimetje: 1,89 €");
    expect(text()).toContain("Ocena spremembe: ~0,11 €");
  });

  it("a package opens Stripe in a new tab (opened inside the click)", async () => {
    const { api, openTab, tab } = await render2();
    await act(async () => button(t("sl", "addCredit"))?.click());
    expect(text()).toContain(t("sl", "creditVat"));
    await act(async () => button("25 €")?.click());
    await flush();
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(api.checkout).toHaveBeenCalledWith(2500);
    expect((tab as { location: { href: string } }).location.href).toBe(
      "https://checkout.stripe.com/c/pay/cs_1",
    );
    expect(text()).toContain(t("sl", "paymentOpened"));
  });

  it("blocked pop-up → message, no checkout", async () => {
    const { api } = await render2({}, null);
    await act(async () => button(t("sl", "addCredit"))?.click());
    await act(async () => button("10 €")?.click());
    expect(api.checkout).not.toHaveBeenCalled();
    expect(text()).toContain(t("sl", "popupBlocked"));
  });

  it("checkout failure closes the empty tab and explains", async () => {
    const close = vi.fn();
    await render2(
      { checkout: vi.fn(async () => ({ ok: false as const, status: 502, error: "payments_failed" })) },
      { location: { href: "" }, close },
    );
    await act(async () => button(t("sl", "addCredit"))?.click());
    await act(async () => button("10 €")?.click());
    await flush();
    expect(close).toHaveBeenCalled();
    expect(text()).toContain(t("sl", "errPayments"));
  });

  it("not enough credit → message and the packages open", async () => {
    await render2({
      edit: vi.fn(async () => ({
        ok: false as const,
        status: 402,
        error: "insufficient_credit",
      })) as SitesApi["edit"],
    });
    await type("x");
    await submit();
    expect(text()).toContain(t("sl", "errInsufficientCredit"));
    expect(button("50 €")).toBeDefined();
  });

  it("the balance follows each change, and refreshes when the tab gets focus again (after paying)", async () => {
    const statusFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: status() })
      .mockResolvedValue({ ok: true, value: status({ balanceCents: 178 }) });
    const { api } = await render2({ status: statusFn });
    await type("x");
    await submit();
    expect(text()).toContain("Dobroimetje: 1,78 €");
    const calls = (api.status as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect((api.status as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls + 1);
  });

  it("no packages (payments not configured) → no top-up button", async () => {
    await render2({
      status: vi.fn(async () => ({ ok: true as const, value: status({ packagesCents: [] }) })),
    });
    expect(button(t("sl", "addCredit"))).toBeUndefined();
  });
});

describe("Editor: images (TASK-015)", () => {
  it("picked images are resized, shown as thumbnails, and sent with the message", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${Math.random()}`);
    const { api } = await setup();
    await pick("terasa.heic", "vrt.jpg");
    expect(fakePrepare).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".attachment img")).toHaveLength(2);
    await type("Dodaj v galerijo");
    await submit();
    const [message, images] = (api.edit as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(message).toBe("Dodaj v galerijo");
    expect(images.map((i: { name: string }) => i.name)).toEqual(["terasa.heic.jpg", "vrt.jpg.jpg"]);
    expect(container.querySelectorAll(".attachment")).toHaveLength(0); // composer cleared
    expect(container.querySelectorAll(".bubble.you .thumbs img")).toHaveLength(2); // shown in the chat
  });

  it("an image can be removed before sending", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${Math.random()}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { api } = await setup();
    await pick("a.jpg");
    await act(async () => (container.querySelector(".attachment .remove") as HTMLButtonElement).click());
    await type("x");
    await submit();
    expect(api.edit).toHaveBeenCalledWith("x", []);
  });

  it(`at most ${MAX_ATTACHMENTS} images`, async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${Math.random()}`);
    await setup();
    await pick("1.jpg", "2.jpg", "3.jpg", "4.jpg");
    expect(container.querySelectorAll(".attachment")).toHaveLength(0);
    expect(text()).toContain(t("sl", "imagesMax"));
  });

  it("an image without text asks where it should go, and sends nothing", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${Math.random()}`);
    const { api } = await setup();
    await pick("a.jpg");
    await submit();
    expect(api.edit).not.toHaveBeenCalled();
    expect(text()).toContain(t("sl", "imageHint"));
  });

  it("an image the browser cannot read gives a message", async () => {
    fakePrepare.mockRejectedValueOnce(new Error("decode"));
    await setup();
    await pick("broken.jpg");
    expect(text()).toContain(t("sl", "imageRead"));
    expect(container.querySelectorAll(".attachment")).toHaveLength(0);
  });

  it.each([
    ["image_type", "errImageType"],
    ["image_too_large", "errImageTooLarge"],
    ["uploads_not_supported", "errUploadsNotSupported"],
  ] as const)("API %s → message", async (error, key) => {
    await setup({
      edit: vi.fn(async () => ({ ok: false as const, status: 400, error })) as SitesApi["edit"],
    });
    await type("x");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t("sl", key));
  });
});

describe("Editor: a change is only reported done once the site serves it", () => {
  /** Renders with fake timers; `statuses` are answered in order (the last one repeats). */
  async function live(statuses: SiteStatus[], api: Partial<SitesApi> = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    let n = 0;
    const statusFn = vi.fn(async () => ({
      ok: true as const,
      value: statuses[Math.min(n++, statuses.length - 1)] as SiteStatus,
    }));
    const full: SitesApi = {
      status: statusFn,
      edit: vi.fn(async () => ({ ok: true as const, value: editOk() })),
      publish: vi.fn(async () => ({
        ok: true as const,
        value: { published: true, sha: "main1", liveUrl: "https://demo.inzenirji.si" },
      })),
      undo: vi.fn(),
      discard: vi.fn(async () => ({ ok: true as const, value: { discarded: true } })),
      checkout: vi.fn(),
      ...api,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      render(
        <Editor lang="sl" email="a@b.si" api={full} onLogout={() => {}} onSessionEnded={() => {}} />,
        container,
      );
    });
    await tick(0);
    return { api: full, statusFn };
  }
  const tick = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    for (let i = 0; i < 3; i++)
      await act(async () => {
        await Promise.resolve();
      });
  };
  async function sendEdit() {
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      ta.value = "Bučna juha naj stane 6,50 €";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await tick(0);
  }

  it("edit: 'preparing' with elapsed time until the build of its commit succeeds, then done with a link", async () => {
    const { statusFn } = await live([
      status(), // on open
      status({ previewSha: "dev1", previewBuild: "pending", unpublished: 1 }), // after the edit
      status({ previewSha: "dev1", previewBuild: "pending", unpublished: 1 }),
      status({ previewSha: "dev1", previewBuild: "success", unpublished: 1 }),
    ]);
    await sendEdit();
    expect(text()).toContain(t("sl", "previewDeploying"));
    expect(text()).not.toContain(t("sl", "previewReady"));
    expect(container.querySelector(".spinner")).not.toBeNull();
    await tick(STATUS_POLL_MS);
    expect(text()).toContain(t("sl", "previewDeploying"));
    expect(text()).toContain("0:05");
    await tick(STATUS_POLL_MS);
    expect(text()).toContain(t("sl", "previewReady"));
    expect(container.querySelector(".spinner")).toBeNull();
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === t("sl", "openPreview"));
    expect(link?.getAttribute("href")).toBe("https://demo-dev.inzenirji.si");
    const calls = statusFn.mock.calls.length;
    await tick(STATUS_POLL_MS * 4);
    expect(statusFn.mock.calls.length).toBe(calls); // polling stops once done
  });

  it("edit: a status still showing the previous commit's finished build does not say done", async () => {
    await live([
      status(),
      status({ previewSha: "dev0", previewBuild: "success" }), // answer from before the commit
      status({ previewSha: "dev1", previewBuild: "success", unpublished: 1 }),
    ]);
    await sendEdit();
    expect(text()).toContain(t("sl", "previewDeploying"));
    expect(text()).not.toContain(t("sl", "previewReady"));
    await tick(STATUS_POLL_MS);
    expect(text()).toContain(t("sl", "previewReady"));
  });

  it.each([
    ["failure", "previewFailed"],
    ["unknown", "previewUnknown"],
  ] as const)("edit: build %s → %s", async (build, key) => {
    await live([status(), status({ previewSha: "dev1", previewBuild: build, unpublished: 1 })]);
    await sendEdit();
    expect(text()).toContain(t("sl", key));
    expect(text()).not.toContain(t("sl", "previewDeploying"));
  });

  it("edit: marks a slow build after a few minutes", async () => {
    await live([status(), status({ previewSha: "dev1", previewBuild: "pending", unpublished: 1 })]);
    await sendEdit();
    await tick(DEPLOY_SLOW_MS);
    expect(text()).toContain(t("sl", "deploySlow"));
  });

  it("an older change is done when the newer commit that contains it is built", async () => {
    const edit = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: editOk({ commitSha: "dev1" }) })
      .mockResolvedValueOnce({ ok: true, value: editOk({ commitSha: "dev2", reply: "Druga." }) });
    await live(
      [
        status(),
        status({ previewSha: "dev1", previewBuild: "pending", unpublished: 1 }),
        status({ previewSha: "dev2", previewBuild: "pending", unpublished: 1 }),
        status({ previewSha: "dev2", previewBuild: "success", unpublished: 1 }),
      ],
      { edit },
    );
    await sendEdit();
    await sendEdit();
    expect(container.querySelectorAll(".deploy-deploying")).toHaveLength(2);
    await tick(STATUS_POLL_MS);
    expect(container.querySelectorAll(".deploy-ready")).toHaveLength(2);
  });

  it("discard stops waiting for changes that will no longer arrive", async () => {
    await live([status(), status({ previewSha: "dev1", previewBuild: "pending", unpublished: 1 })]);
    await sendEdit();
    await act(async () => button(t("sl", "discard"))?.click());
    await act(async () => button(t("sl", "confirmDiscard"))?.click());
    await tick(0);
    expect(text()).toContain(t("sl", "previewDiscarded"));
    expect(container.querySelector(".spinner")).toBeNull();
  });

  it("publish: 'publishing' until the live site is built from the published commit", async () => {
    await live([
      status({ unpublished: 1, previewSha: "dev1" }),
      status({ liveSha: "main1", liveBuild: "pending" }),
      status({ liveSha: "main1", liveBuild: "success" }),
    ]);
    await act(async () => button(t("sl", "publish"))?.click());
    await act(async () => button(t("sl", "confirmPublish"))?.click());
    await tick(0);
    expect(text()).toContain(t("sl", "publishDeploying"));
    await tick(STATUS_POLL_MS);
    expect(text()).toContain(t("sl", "publishReady"));
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === t("sl", "openLive"));
    expect(link?.getAttribute("href")).toBe("https://demo.inzenirji.si");
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

  it("sends images as multipart/form-data, without a JSON content type", async () => {
    const f = vi.fn(
      async (_i: string, _init?: RequestInit) => new Response(JSON.stringify(editOk()), { status: 200 }),
    );
    await createSitesApi(f)("demo", "S".repeat(43)).edit("v galerijo", [
      { blob: new Blob([new Uint8Array([1])]), name: "a.jpg" },
    ]);
    const init = f.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull(); // the browser sets the boundary
    const form = init?.body as FormData;
    expect(form.get("message")).toBe("v galerijo");
    expect((form.getAll("images")[0] as File).name).toBe("a.jpg");
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
    [-5, "−0,05 €"],
    [0, "0,00 €"],
    [6, "0,06 €"],
    [1234, "12,34 €"],
  ])("formatCents(%i) = %s", (c, s) => {
    expect(formatCents(c)).toBe(s);
  });
});
