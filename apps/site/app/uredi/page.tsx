import type { Metadata } from "next";
import { loadContent } from "@/lib/content";

// The editor page (ADR-011, docs/template/uredi-page.md): hidden from search engines, no header/footer,
// only the embed script, which opens the editor full screen.
const EDITOR_ORIGIN = process.env.NEXT_PUBLIC_EDITOR_ORIGIN ?? "https://uredi.inzenirji.si";

export const metadata: Metadata = {
  title: { absolute: "Urejevalnik" },
  robots: { index: false, follow: false },
  // The editor's own icon ("I_"), served by the editor origin so every client site shows the same tab icon on /uredi
  // and a change reaches all sites at once.
  icons: { icon: [{ url: `${EDITOR_ORIGIN}/favicon.svg`, type: "image/svg+xml" }] },
};

export default function UrediPage() {
  const { site } = loadContent();
  // A plain classic script in the HTML: the embed reads document.currentScript and data-site.
  return <script src={`${EDITOR_ORIGIN}/embed.js`} data-site={site.id} defer />;
}
