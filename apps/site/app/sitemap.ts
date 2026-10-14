import type { MetadataRoute } from "next";
import { loadContent } from "@/lib/content";

export const dynamic = "force-static";

/** Content pages only; /uredi is never listed (ADR-011). */
export default function sitemap(): MetadataRoute.Sitemap {
  const { site, pages } = loadContent();
  return Object.keys(pages)
    .sort()
    .map((slug) => ({ url: slug === "index" ? site.url : `${site.url}/${slug}` }));
}
