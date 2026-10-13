import { isHttpOrigin, parseWidgetToEmbed } from "@inzenirji/shared/embed-protocol";
import { isValidSiteId } from "@inzenirji/shared/site-id";

export const IFRAME_ID = "inzenirji-editor";

export interface MountResult {
  iframe: HTMLIFrameElement;
  /** Removes the message listener (used by tests). */
  dispose: () => void;
}

/**
 * Mounts the editor iframe for the site named in the script tag's `data-site` attribute.
 * Returns null (and logs) when the configuration is invalid; returns the existing iframe if already mounted.
 */
export function mount(script: HTMLScriptElement | null, win: Window = window): MountResult | null {
  const doc = win.document;
  const siteId = script?.dataset.site;
  if (!isValidSiteId(siteId)) {
    console.error("[inzenirji] Missing or invalid data-site on the editor script.");
    return null;
  }

  const editorOrigin = resolveEditorOrigin(script);
  if (!editorOrigin) {
    console.error("[inzenirji] Cannot determine the editor origin.");
    return null;
  }

  const existing = doc.getElementById(IFRAME_ID);
  if (existing?.tagName === "IFRAME") {
    return { iframe: existing as HTMLIFrameElement, dispose: () => {} };
  }

  const src = new URL("/", editorOrigin);
  src.searchParams.set("site", siteId);
  src.searchParams.set("origin", win.location.origin);

  const iframe = doc.createElement("iframe");
  iframe.id = IFRAME_ID;
  iframe.src = src.toString();
  iframe.title = "Urejevalnik spletne strani";
  iframe.allow = "clipboard-write";
  iframe.setAttribute(
    "style",
    "position:fixed;inset:0;width:100%;height:100%;border:0;margin:0;z-index:2147483647;background:#fff",
  );
  doc.body.appendChild(iframe);

  const onMessage = (event: MessageEvent) => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow || event.source !== frameWindow || event.origin !== editorOrigin) return;
    const message = parseWidgetToEmbed(event.data);
    if (message?.type === "widget:close") {
      if (win.history.length > 1) win.history.back();
      else win.location.assign("/");
    }
  };
  win.addEventListener("message", onMessage);

  return { iframe, dispose: () => win.removeEventListener("message", onMessage) };
}

function resolveEditorOrigin(script: HTMLScriptElement | null): string | null {
  const override = script?.dataset.editorOrigin;
  if (override !== undefined) return isHttpOrigin(override) ? override : null;
  if (!script?.src) return null;
  try {
    const origin = new URL(script.src).origin;
    return isHttpOrigin(origin) ? origin : null;
  } catch {
    return null;
  }
}
