import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IFRAME_ID, mount } from "./embed.ts";

const EDITOR = "https://uredi.inzenirji.si";

function makeScript(attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  return script;
}

function iframes() {
  return document.querySelectorAll(`#${IFRAME_ID}`);
}

function post(data: unknown, origin: string, source: MessageEventSource | null) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

describe("mount", () => {
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const d of disposers.splice(0)) d();
    vi.restoreAllMocks();
  });

  function mountOk(script: HTMLScriptElement) {
    const result = mount(script);
    if (!result) throw new Error("expected mount to succeed");
    disposers.push(result.dispose);
    return result;
  }

  it("creates one iframe pointing at the editor origin with site and page origin", () => {
    const { iframe } = mountOk(makeScript({ src: `${EDITOR}/embed.js`, "data-site": "hisa-denk" }));
    const url = new URL(iframe.src);
    expect(url.origin).toBe(EDITOR);
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("site")).toBe("hisa-denk");
    expect(url.searchParams.get("origin")).toBe(window.location.origin);
    expect(iframes()).toHaveLength(1);
  });

  it("uses data-editor-origin when given (local development)", () => {
    const { iframe } = mountOk(
      makeScript({
        src: "/embed.js",
        "data-site": "demo-site",
        "data-editor-origin": "http://localhost:5173",
      }),
    );
    expect(new URL(iframe.src).origin).toBe("http://localhost:5173");
  });

  it.each([
    ["missing site", { src: `${EDITOR}/embed.js` }],
    ["invalid site", { src: `${EDITOR}/embed.js`, "data-site": "Hisa Denk" }],
    [
      "invalid editor origin override",
      { src: `${EDITOR}/embed.js`, "data-site": "abc", "data-editor-origin": "*" },
    ],
  ])("does not mount with %s", (_name, attrs) => {
    expect(mount(makeScript(attrs))).toBeNull();
    expect(iframes()).toHaveLength(0);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("does not mount without a script element", () => {
    expect(mount(null)).toBeNull();
    expect(iframes()).toHaveLength(0);
  });

  it("is idempotent: a second load reuses the iframe", () => {
    const script = makeScript({ src: `${EDITOR}/embed.js`, "data-site": "hisa-denk" });
    const first = mountOk(script);
    const second = mountOk(script);
    expect(second.iframe).toBe(first.iframe);
    expect(iframes()).toHaveLength(1);
  });

  describe("close message", () => {
    // happy-dom does not load iframe pages, so stand in a fake window for the iframe's contentWindow.
    function setup(frameWindow: object | null = { name: "editor-frame" }) {
      const { iframe } = mountOk(makeScript({ src: `${EDITOR}/embed.js`, "data-site": "hisa-denk" }));
      Object.defineProperty(iframe, "contentWindow", { configurable: true, get: () => frameWindow });
      const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
      const lengthSpy = vi.spyOn(window.history, "length", "get").mockReturnValue(2);
      const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
      return { source: frameWindow as MessageEventSource | null, back, assign, lengthSpy };
    }
    const close = { v: 1, type: "widget:close" };

    it("goes back when the widget sends a valid close message", () => {
      const { source, back } = setup();
      post(close, EDITOR, source);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("navigates to / when there is no history to go back to", () => {
      const { source, back, assign, lengthSpy } = setup();
      lengthSpy.mockReturnValue(1);
      post(close, EDITOR, source);
      expect(back).not.toHaveBeenCalled();
      expect(assign).toHaveBeenCalledWith("/");
    });

    it("ignores a close message from another origin", () => {
      const { source, back } = setup();
      post(close, "https://evil.example", source);
      expect(back).not.toHaveBeenCalled();
    });

    it("ignores a close message from another window with the right origin", () => {
      const { back } = setup();
      post(close, EDITOR, window);
      expect(back).not.toHaveBeenCalled();
    });

    it("ignores everything while the iframe has no window", () => {
      const { back } = setup(null);
      post(close, EDITOR, null);
      expect(back).not.toHaveBeenCalled();
    });

    it("ignores malformed messages", () => {
      const { source, back } = setup();
      post({ v: 2, type: "widget:close" }, EDITOR, source);
      post("widget:close", EDITOR, source);
      post({ v: 1, type: "widget:close", extra: true }, EDITOR, source);
      expect(back).not.toHaveBeenCalled();
    });
  });
});

describe("login token handoff", () => {
  const EDITOR = "https://uredi.inzenirji.si";
  const TOKEN = "T".repeat(40).concat("a-_");
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/uredi");
  });
  afterEach(() => {
    for (const d of disposers.splice(0)) d();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  function mountWithHash(hash: string) {
    window.history.replaceState(null, "", `/uredi?x=1${hash}`);
    const script = document.createElement("script");
    script.setAttribute("src", `${EDITOR}/embed.js`);
    script.setAttribute("data-site", "hisa-denk");
    const result = mount(script);
    if (!result) throw new Error("mount failed");
    disposers.push(result.dispose);
    const frame = { postMessage: vi.fn() };
    Object.defineProperty(result.iframe, "contentWindow", { configurable: true, get: () => frame });
    const ready = (origin = EDITOR, source: unknown = frame) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { v: 1, type: "widget:ready" },
          origin,
          source: source as MessageEventSource,
        }),
      );
    return { frame, ready };
  }

  it("removes #login from the address bar immediately, keeping path and query", () => {
    mountWithHash(`#login=${TOKEN}`);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/uredi");
    expect(window.location.search).toBe("?x=1");
  });

  it("sends the token to the widget once, only after widget:ready, to the editor origin", () => {
    const { frame, ready } = mountWithHash(`#login=${TOKEN}`);
    expect(frame.postMessage).not.toHaveBeenCalled();
    ready();
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
    expect(frame.postMessage).toHaveBeenCalledWith({ v: 1, type: "embed:login", token: TOKEN }, EDITOR);
    ready();
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send the token when widget:ready comes from a wrong origin or window", () => {
    const { frame, ready } = mountWithHash(`#login=${TOKEN}`);
    ready("https://evil.example");
    ready(EDITOR, window);
    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it.each(["", "#login=short", `#login=${TOKEN}x`, `#other=${TOKEN}`])(
    "sends nothing for hash %j",
    (hash) => {
      const { frame, ready } = mountWithHash(hash);
      ready();
      expect(frame.postMessage).not.toHaveBeenCalled();
      if (hash) expect(window.location.hash).toBe(hash);
    },
  );
});

describe("login link opened in a tab that already shows /uredi", () => {
  const EDITOR = "https://uredi.inzenirji.si";
  const TOKEN = "H".repeat(43);
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("picks the token up on hashchange and sends it at once when the widget is ready", () => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/uredi");
    const script = document.createElement("script");
    script.setAttribute("src", `${EDITOR}/embed.js`);
    script.setAttribute("data-site", "hisa-denk");
    const result = mount(script);
    if (!result) throw new Error("mount failed");
    const frame = { postMessage: vi.fn() };
    Object.defineProperty(result.iframe, "contentWindow", { configurable: true, get: () => frame });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { v: 1, type: "widget:ready" },
        origin: EDITOR,
        source: frame as unknown as MessageEventSource,
      }),
    );
    expect(frame.postMessage).not.toHaveBeenCalled();

    window.history.replaceState(null, "", `/uredi#login=${TOKEN}`);
    window.dispatchEvent(new Event("hashchange"));
    expect(frame.postMessage).toHaveBeenCalledWith({ v: 1, type: "embed:login", token: TOKEN }, EDITOR);
    expect(window.location.hash).toBe("");
    result.dispose();
  });
});
