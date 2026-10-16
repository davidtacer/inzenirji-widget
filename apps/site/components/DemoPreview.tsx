"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { BlockView } from "@/components/Blocks";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { type DemoContent, firstChangedBlock, parseDemoMessage, slugOfHref } from "@/lib/demo";

/**
 * Public demo (TASK-016): renders the visitor's sandbox content in the browser with the site's own components and
 * hosts the editor (widget, mode=demo) next to it. Links inside the preview switch pages without leaving the demo.
 */
export function DemoPreview({ initial, editorOrigin }: { initial: DemoContent; editorOrigin: string }) {
  const [content, setContent] = useState<DemoContent>(initial);
  const [slug, setSlug] = useState("index");
  const [focus, setFocus] = useState<{ n: number; block: number } | null>(null);
  const contentRef = useRef(initial);
  const [src, setSrc] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = new URL("/", editorOrigin);
    url.searchParams.set("mode", "demo");
    url.searchParams.set("origin", window.location.origin);
    setSrc(url.toString());
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== editorOrigin || event.source !== frame.current?.contentWindow) return;
      const parsed = parseDemoMessage(event.data);
      if (!parsed) return;
      const before = contentRef.current;
      contentRef.current = parsed.content;
      setContent(parsed.content);
      if (parsed.page) {
        setSlug(parsed.page);
        setFocus((f) => ({
          n: (f?.n ?? 0) + 1,
          block: firstChangedBlock(before, parsed.content, parsed.page as string),
        }));
      } else {
        setSlug((s) => (s in parsed.content.pages ? s : "index"));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [editorOrigin]);

  // After a change: scroll to the first changed block of the page and flash it.
  useEffect(() => {
    if (!focus) return;
    const main = preview.current?.querySelector("main");
    const el = (main?.children[focus.block] ?? main) as HTMLElement | undefined;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("demo-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("demo-flash");
  }, [focus]);

  // Links in the preview (also activated with the keyboard, which fires click) switch pages inside the demo.
  const pagesRef = useRef(content.pages);
  pagesRef.current = content.pages;
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      const href = a?.getAttribute("href");
      if (!a || !href || a.closest(".demo-bar")) return;
      e.preventDefault();
      if (href.startsWith("tel:") || href.startsWith("mailto:")) return; // fictional restaurant: never dial or mail
      const target = slugOfHref(href);
      if (!target) {
        window.open(href, "_blank", "noopener");
        return;
      }
      if (target.slug in pagesRef.current) setSlug(target.slug);
      requestAnimationFrame(() => {
        const anchor = target.hash ? el.querySelector(`#${CSS.escape(target.hash)}`) : null;
        if (anchor) anchor.scrollIntoView({ behavior: "smooth" });
        else el.scrollTo({ top: 0 });
      });
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  const { site, pages } = content;
  const page = pages[slug] ?? pages.index;
  const { colors, fonts } = site.theme;
  const theme = {
    "--c-primary": colors.primary,
    "--c-bg": colors.background,
    "--c-text": colors.text,
    "--c-accent": colors.accent,
    "--f-heading": fonts.heading,
    "--f-body": fonts.body,
  } as CSSProperties;

  return (
    <div className="demo-layout">
      <div className="demo-preview" ref={preview} style={theme}>
        <div className="demo-bar" role="note">
          <span>
            <strong>Predogled</strong> · {page?.title ?? ""} · spremembe vidite samo vi
          </span>
          <a className="demo-bar-link" href="https://inzenirji.si/urejevalnik" target="_blank" rel="noopener">
            Inženirji.si
          </a>
        </div>
        <div>
          <SiteHeader site={site} />
          <main>
            {page?.blocks.map((block, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no id
              <BlockView key={`${slug}-${block.type}-${i}`} block={block} site={site} />
            ))}
          </main>
          <SiteFooter site={site} />
        </div>
      </div>
      <div className="demo-editor">
        {src && <iframe ref={frame} src={src} title="Urejevalnik (demo)" allow="clipboard-write" />}
      </div>
    </div>
  );
}
