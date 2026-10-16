import type { Site } from "@inzenirji/site-schema";

/** Site header and footer, shared by the real pages and the demo preview (TASK-016). Content only from JSON. */
export function SiteHeader({ site }: { site: Site }) {
  return (
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
  );
}

export function SiteFooter({ site }: { site: Site }) {
  return (
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
  );
}
