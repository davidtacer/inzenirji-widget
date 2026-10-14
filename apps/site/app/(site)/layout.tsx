import type { ReactNode } from "react";
import { loadContent } from "@/lib/content";

export default function SiteLayout({ children }: { children: ReactNode }) {
  const { site } = loadContent();
  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="/">
            {site.name}
          </a>
          <nav aria-label="Glavni meni">
            <ul>
              {site.navigation.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div className="container">
          <p>
            <strong>{site.name}</strong>
            {site.contact.address ? ` · ${site.contact.address}` : ""}
            {site.contact.phone ? ` · ${site.contact.phone}` : ""}
          </p>
          {site.footerNote && <p className="muted">{site.footerNote}</p>}
        </div>
      </footer>
    </>
  );
}
