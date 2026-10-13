import { type Block, DAY_LABELS, formatPrice, type Site } from "@inzenirji/site-schema";

/** Renders one content block. The design is fixed here; content comes only from JSON (product plan §1). */
export function BlockView({ block, site }: { block: Block; site: Site }) {
  switch (block.type) {
    case "hero":
      return (
        <section className="hero">
          <div className="container hero-inner">
            <div>
              <h1>{block.heading}</h1>
              {block.subheading && <p className="lead">{block.subheading}</p>}
              {block.cta && (
                <a className="button" href={block.cta.href}>
                  {block.cta.label}
                </a>
              )}
            </div>
            {block.image && <img className="hero-image" src={block.image.src} alt={block.image.alt} />}
          </div>
        </section>
      );
    case "notice":
      return (
        <div className={`notice notice-${block.tone}`} role="note">
          <div className="container">{block.text}</div>
        </div>
      );
    case "text":
      return (
        <section className="section container narrow">
          {block.heading && <h2>{block.heading}</h2>}
          {block.body.split(/\n{2,}/).map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>
      );
    case "services":
      return (
        <section className="section container">
          <h2>{block.heading}</h2>
          <div className="cards">
            {block.items.map((item) => (
              <article className="card" key={item.name}>
                <h3>{item.name}</h3>
                {item.description && <p>{item.description}</p>}
                <p className="meta">
                  {item.duration && <span>{item.duration}</span>}
                  {item.priceCents !== undefined && <strong>{formatPrice(item.priceCents)}</strong>}
                </p>
              </article>
            ))}
          </div>
        </section>
      );
    case "menu":
      return (
        <section className="section container narrow">
          <h2>{block.heading}</h2>
          {block.groups.map((group) => (
            <div className="menu-group" key={group.name}>
              <h3>{group.name}</h3>
              <ul className="menu-list">
                {group.items.map((item) => (
                  <li key={item.name}>
                    <div className="menu-row">
                      <span className="menu-name">{item.name}</span>
                      <span className="menu-dots" aria-hidden="true" />
                      <span className="menu-price">{formatPrice(item.priceCents)}</span>
                    </div>
                    {item.description && <p className="menu-desc">{item.description}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {block.note && <p className="muted">{block.note}</p>}
        </section>
      );
    case "gallery":
      return (
        <section className="section container">
          {block.heading && <h2>{block.heading}</h2>}
          <div className="gallery">
            {block.images.map((img) => (
              <img key={img.src + img.alt} src={img.src} alt={img.alt} loading="lazy" />
            ))}
          </div>
        </section>
      );
    case "hours":
      return (
        <section className="section container narrow" id="delovni-cas">
          <h2>{block.heading ?? "Delovni čas"}</h2>
          <dl className="hours">
            {site.hours.map((h) => (
              <div key={h.days.join("-")}>
                <dt>{h.days.map((d) => DAY_LABELS[d]).join(", ")}</dt>
                <dd>
                  {h.closed ? "zaprto" : h.open && h.close ? `${h.open}–${h.close}` : ""}
                  {h.note ? ` (${h.note})` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case "contact":
      return (
        <section className="section container narrow" id="kontakt">
          <h2>{block.heading ?? "Kontakt"}</h2>
          <ul className="contact">
            {site.contact.address && <li>{site.contact.address}</li>}
            {site.contact.phone && (
              <li>
                <a href={`tel:${site.contact.phone.replace(/\s+/g, "")}`}>{site.contact.phone}</a>
              </li>
            )}
            {site.contact.email && (
              <li>
                <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a>
              </li>
            )}
          </ul>
        </section>
      );
    case "faq":
      return (
        <section className="section container narrow">
          <h2>{block.heading}</h2>
          {block.items.map((item) => (
            <details key={item.question} className="faq">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </section>
      );
  }
}
