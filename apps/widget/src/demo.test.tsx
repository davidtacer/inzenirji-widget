import { DEMO_CONTENT_TYPE } from "@inzenirji/shared/embed-protocol";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_TEXT, Demo, SUGGESTIONS } from "./Demo.tsx";
import type { DemoApi, DemoState } from "./demo-api.ts";
import { readParams } from "./params.ts";

const content = { site: { name: "Gostilna" }, pages: { index: {}, meni: {} } };
const state = (over: Partial<DemoState> = {}): DemoState => ({
  content,
  edits: 0,
  limit: 5,
  emailGiven: false,
  expiresAt: Date.now() + 1e7,
  ...over,
});

function fakeApi(over: Partial<DemoApi> = {}): DemoApi {
  return {
    config: vi.fn(async () => ({
      ok: true as const,
      value: { turnstileSiteKey: null, freeEdits: 5, emailEdits: 10 },
    })),
    start: vi.fn(async () => ({ ok: true as const, value: { ...state(), token: "T".repeat(43) } })),
    state: vi.fn(async () => ({ ok: false as const, status: 401, error: "sandbox_expired" })),
    edit: vi.fn(async () => ({
      ok: true as const,
      value: { ...state({ edits: 1 }), reply: "Dodano.", changed: true, escalated: false, pages: ["meni"] },
    })),
    reset: vi.fn(async () => ({ ok: true as const, value: state() })),
    email: vi.fn(async () => ({
      ok: true as const,
      value: state({ edits: 5, limit: 15, emailGiven: true }),
    })),
    ...over,
  };
}

const memoryTokens = () => {
  let saved: string | null = null;
  return {
    load: vi.fn(() => saved),
    save: vi.fn((t: string) => {
      saved = t;
    }),
    clear: vi.fn(() => {
      saved = null;
    }),
  };
};

let container: HTMLElement;
afterEach(() => {
  if (!container) return;
  act(() => render(null, container));
  container.remove();
});

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const text = () => container.textContent ?? "";
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;

async function mount(api: DemoApi, tokens = memoryTokens()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const post = vi.fn();
  act(() =>
    render(
      <Demo parentOrigin="https://demo.inzenirji.si" api={api} post={post} tokens={tokens} />,
      container,
    ),
  );
  await flush();
  await flush();
  return { post, tokens };
}

describe("demo widget (TASK-016)", () => {
  it("reads mode=demo from the URL", () => {
    expect(readParams("?mode=demo&origin=https://demo.inzenirji.si").mode).toBe("demo");
    expect(readParams("?site=demo").mode).toBe("editor");
  });

  it("starts a sandbox, sends its content to the demo page and saves the token", async () => {
    const api = fakeApi();
    const { post, tokens } = await mount(api);
    expect(api.start).toHaveBeenCalledWith(null);
    expect(tokens.save).toHaveBeenCalledWith("T".repeat(43), expect.any(Number));
    expect(post).toHaveBeenCalledWith(
      { v: 1, type: DEMO_CONTENT_TYPE, content, page: null },
      "https://demo.inzenirji.si",
    );
    expect(text()).toContain(DEMO_TEXT.counter(0, 5));
  });

  it("re-uses a stored sandbox", async () => {
    const tokens = memoryTokens();
    tokens.save("S".repeat(43));
    const api = fakeApi({ state: vi.fn(async () => ({ ok: true as const, value: state({ edits: 2 }) })) });
    await mount(api, tokens);
    expect(api.start).not.toHaveBeenCalled();
    expect(text()).toContain(DEMO_TEXT.counter(2, 5));
  });

  it("sends a suggestion, shows the reply and jumps the preview to the changed page", async () => {
    const api = fakeApi();
    const { post } = await mount(api);
    act(() => button(SUGGESTIONS[0]!)?.click());
    await flush();
    expect(api.edit).toHaveBeenCalledWith("T".repeat(43), SUGGESTIONS[0]);
    expect(text()).toContain("Dodano.");
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: "meni" }),
      "https://demo.inzenirji.si",
    );
    expect(text()).toContain(DEMO_TEXT.counter(1, 5));
  });

  it("asks for an e-mail when the free edits are used, then continues", async () => {
    const api = fakeApi({
      edit: vi.fn(async () => ({ ok: false as const, status: 402, error: "email_required" })),
    });
    await mount(api);
    act(() => button(SUGGESTIONS[1]!)?.click());
    await flush();
    expect(text()).toContain(DEMO_TEXT.emailTitle);
    const input = container.querySelector<HTMLInputElement>("#demo-email")!;
    act(() => {
      input.value = "narobe";
      input.dispatchEvent(new Event("input"));
    });
    act(() => container.querySelector<HTMLFormElement>(".demo-email")!.requestSubmit());
    await flush();
    expect(text()).toContain(DEMO_TEXT.emailInvalid);
    expect(api.email).not.toHaveBeenCalled();
    act(() => {
      input.value = "ana@primer.si";
      input.dispatchEvent(new Event("input"));
    });
    act(() => container.querySelector<HTMLFormElement>(".demo-email")!.requestSubmit());
    await flush();
    expect(api.email).toHaveBeenCalledWith("T".repeat(43), "ana@primer.si", "");
    expect(text()).toContain(DEMO_TEXT.emailThanks);
    expect(text()).toContain(DEMO_TEXT.counter(5, 15));
  });

  it("shows the booking link when every edit is used", async () => {
    const api = fakeApi({
      edit: vi.fn(async () => ({ ok: false as const, status: 402, error: "demo_limit" })),
    });
    await mount(api);
    act(() => button(SUGGESTIONS[0]!)?.click());
    await flush();
    expect(text()).toContain(DEMO_TEXT.limitDone);
    expect(container.querySelector<HTMLTextAreaElement>("#demo-message")!.disabled).toBe(true);
  });

  it("explains publishing and resets the page", async () => {
    const api = fakeApi();
    const { post } = await mount(api);
    act(() => button(DEMO_TEXT.publish)?.click());
    expect(text()).toContain(DEMO_TEXT.publishNote);
    act(() => button(DEMO_TEXT.reset)?.click());
    await flush();
    expect(api.reset).toHaveBeenCalled();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: "index" }),
      "https://demo.inzenirji.si",
    );
  });

  it("tells the visitor when the demo is paused for the day", async () => {
    const api = fakeApi({
      edit: vi.fn(async () => ({ ok: false as const, status: 503, error: "demo_paused" })),
    });
    await mount(api);
    act(() => button(SUGGESTIONS[0]!)?.click());
    await flush();
    expect(text()).toContain(DEMO_TEXT.paused);
  });
});
