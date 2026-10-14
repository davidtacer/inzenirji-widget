import type { Metadata } from "next";
import { loadContent } from "@/lib/content";

// The editor page (ADR-011, docs/template/uredi-page.md): hidden from search engines, no header/footer,
// only the embed script, which opens the editor full screen.
export const metadata: Metadata = {
  title: { absolute: "Urejevalnik" },
  robots: { index: false, follow: false },
};

const EDITOR_ORIGIN = process.env.NEXT_PUBLIC_EDITOR_ORIGIN ?? "https://uredi.inzenirji.si";

export default function UrediPage() {
  const { site } = loadContent();
  // A plain classic script in the HTML: the embed reads document.currentScript and data-site.
  return <script src={`${EDITOR_ORIGIN}/embed.js`} data-site={site.id} defer />;
}
