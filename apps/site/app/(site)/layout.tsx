import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { loadContent } from "@/lib/content";

export default function SiteLayout({ children }: { children: ReactNode }) {
  const { site } = loadContent();
  return (
    <>
      <SiteHeader site={site} />
      <main>{children}</main>
      <SiteFooter site={site} />
    </>
  );
}
