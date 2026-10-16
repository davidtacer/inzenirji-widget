import type { Metadata } from "next";
import { DemoPreview } from "@/components/DemoPreview";
import { loadContent } from "@/lib/content";

// Public editor demo (TASK-016, ADR-015): the site on the left, rendered in the browser from the visitor's sandbox
// content; the editor (widget in demo mode) on the right. Under /uredi, so it is never indexed (ADR-011).
const EDITOR_ORIGIN = process.env.NEXT_PUBLIC_EDITOR_ORIGIN ?? "https://uredi.inzenirji.si";

export const metadata: Metadata = {
  title: { absolute: "Preizkusite urejevalnik · Inženirji.si" },
  description: "Spremenite demo spletno stran sami, s preprostim sporočilom. Brez prijave.",
  robots: { index: false, follow: false },
  icons: { icon: [{ url: `${EDITOR_ORIGIN}/favicon.svg`, type: "image/svg+xml" }] },
};

export default function DemoPage() {
  const { site, pages } = loadContent();
  return <DemoPreview initial={{ site, pages }} editorOrigin={EDITOR_ORIGIN} />;
}
