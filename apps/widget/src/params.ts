import { isHttpOrigin } from "@inzenirji/shared/embed-protocol";
import { isValidSiteId } from "@inzenirji/shared/site-id";
import { type Lang, pickLang } from "./i18n.ts";

export interface WidgetParams {
  /** Validated site id, or null if missing/invalid. */
  siteId: string | null;
  /**
   * Origin of the client page that embeds us, used as the exact postMessage target.
   * Null if missing/invalid — then we never post to the parent (never "*").
   */
  parentOrigin: string | null;
  lang: Lang;
  /** "demo" opens the public demo (TASK-016) instead of the editor. */
  mode: "editor" | "demo";
}

export function readParams(search: string): WidgetParams {
  const q = new URLSearchParams(search);
  const site = q.get("site");
  const origin = q.get("origin");
  return {
    siteId: isValidSiteId(site) ? site : null,
    parentOrigin: isHttpOrigin(origin) ? origin : null,
    lang: pickLang(q.get("lang")),
    mode: q.get("mode") === "demo" ? "demo" : "editor",
  };
}
