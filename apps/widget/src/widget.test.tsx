import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { messages, pickLang, t } from "./i18n.ts";
import { readParams } from "./params.ts";
import { postToParent } from "./parent.ts";

describe("i18n", () => {
  it("sl and en have exactly the same keys and no empty strings", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.sl).sort());
    for (const lang of ["sl", "en"] as const) {
      for (const value of Object.values(messages[lang])) expect(value.trim()).not.toBe("");
    }
  });

  it.each([
    [null, "sl"],
    ["", "sl"],
    ["sl", "sl"],
    ["de", "sl"],
    ["en", "en"],
    ["EN-gb", "en"],
  ])("pickLang(%j) → %s", (value, lang) => {
    expect(pickLang(value)).toBe(lang);
  });
});

describe("readParams", () => {
  it("accepts a valid site and origin", () => {
    expect(readParams("?site=hisa-denk&origin=https%3A%2F%2Fhisa-denk.si&lang=en")).toEqual({
      siteId: "hisa-denk",
      parentOrigin: "https://hisa-denk.si",
      lang: "en",
    });
  });

  it.each([
    ["missing everything", "", null, null],
    ["invalid site", "?site=Hisa%20Denk&origin=https%3A%2F%2Fa.si", null, "https://a.si"],
    ["wildcard origin", "?site=abc&origin=*", "abc", null],
    ["origin with path", "?site=abc&origin=https%3A%2F%2Fa.si%2Furedi", "abc", null],
    ["javascript origin", "?site=abc&origin=javascript%3Aalert(1)", "abc", null],
  ])("%s", (_name, search, siteId, parentOrigin) => {
    const p = readParams(search);
    expect(p.siteId).toBe(siteId);
    expect(p.parentOrigin).toBe(parentOrigin);
  });
});

describe("postToParent", () => {
  function fakeWindow() {
    const parent = { postMessage: vi.fn() };
    return { parent: parent as unknown as Window, self: {} as unknown, postMessage: parent.postMessage };
  }

  it("posts the versioned message to the exact parent origin", () => {
    const win = fakeWindow();
    expect(postToParent("widget:close", "https://hisa-denk.si", win)).toBe(true);
    expect(win.postMessage).toHaveBeenCalledWith({ v: 1, type: "widget:close" }, "https://hisa-denk.si");
  });

  it("never posts without a known parent origin", () => {
    const win = fakeWindow();
    expect(postToParent("widget:close", null, win)).toBe(false);
    expect(win.postMessage).not.toHaveBeenCalled();
  });

  it("does not post when not inside a frame", () => {
    const parent = { postMessage: vi.fn() };
    const win = { parent: parent as unknown as Window, self: parent as unknown };
    expect(postToParent("widget:ready", "https://a.si", win)).toBe(false);
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});

describe("App", () => {
  let container: HTMLElement;
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function mountApp(search: string) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(<App params={readParams(search)} />, container));
  }

  it("shows an alert for an invalid site id", () => {
    mountApp("?site=X");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t("sl", "invalidSite"));
  });

  it("shows the site id and Slovenian title for a valid site", () => {
    mountApp("?site=hisa-denk");
    expect(container.querySelector("h1")?.textContent).toBe("Urejevalnik");
    expect(container.querySelector(".site")?.textContent).toBe("hisa-denk");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
