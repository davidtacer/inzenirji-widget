import type { MetadataRoute } from "next";
import { loadContent } from "@/lib/content";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const { site } = loadContent();
  // Preview builds (hidden test site) must never be crawled at all.
  if (process.env.SITE_PREVIEW === "1") return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/uredi"] }],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
