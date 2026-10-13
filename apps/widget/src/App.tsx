import { useEffect } from "preact/hooks";
import { t } from "./i18n.ts";
import type { WidgetParams } from "./params.ts";
import { postToParent } from "./parent.ts";

export function App({ params }: { params: WidgetParams }) {
  const { siteId, parentOrigin, lang } = params;

  useEffect(() => {
    if (siteId) postToParent("widget:ready", parentOrigin);
  }, [siteId, parentOrigin]);

  return (
    <div class="shell">
      <header class="header">
        <div>
          <h1>{t(lang, "title")}</h1>
          {siteId && <p class="site">{siteId}</p>}
        </div>
        <button type="button" class="close" onClick={() => postToParent("widget:close", parentOrigin)}>
          {t(lang, "close")}
        </button>
      </header>
      <main class="main">
        {siteId ? (
          <>
            <p>{t(lang, "subtitle")}</p>
            <p class="muted">{t(lang, "comingSoon")}</p>
          </>
        ) : (
          <p role="alert" class="error">
            {t(lang, "invalidSite")}
          </p>
        )}
      </main>
    </div>
  );
}
