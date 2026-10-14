import { z } from "zod";

/**
 * Content schema of a client site (ADR-007/ADR-012). The site renders only what passes these schemas, and the
 * editing agent's writes are validated against them before anything is committed.
 * Money: prices are integer euro cents (ADR-005).
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Root-relative link ("/meni", "/#kontakt"), mail/phone link or https URL. */
export const Href = z
  .string()
  .max(500)
  .regex(/^(\/(?!\/)|#|mailto:|tel:|https:\/\/)/, "Link must start with /, #, mailto:, tel: or https://");

/** Image path inside the site ("/uploads/…") or an https URL. */
export const ImageSrc = z
  .string()
  .max(500)
  .regex(
    /^(\/uploads\/(?!.*\.\.)[A-Za-z0-9._/-]+|https:\/\/\S+)$/,
    "Image must be /uploads/<file> or an https URL",
  );

export const Image = z.strictObject({ src: ImageSrc, alt: text(200) });

/** Price in integer euro cents, 0 … 1 000 000 € */
export const PriceCents = z
  .number()
  .int()
  .min(0)
  .max(100_000_000)
  .describe("Price in integer euro cents: 6,50 € is 650. Never decimals.");

/** Rules are regexes, not refinements, so they survive into the JSON Schema the editor validates with (ADR-013). */
export const Slug = z
  .string()
  .regex(
    /^(?!uredi$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    "Slug: lowercase letters, digits, hyphens; 'uredi' is reserved for the editor",
  );

const Cta = z.strictObject({ label: text(60), href: Href });

export const HeroBlock = z.strictObject({
  type: z.literal("hero"),
  heading: text(120),
  subheading: optionalText(300),
  image: Image.optional(),
  cta: Cta.optional(),
});

export const NoticeBlock = z.strictObject({
  type: z.literal("notice"),
  text: text(300),
  tone: z.enum(["info", "warning"]).default("info"),
});

export const TextBlock = z.strictObject({
  type: z.literal("text"),
  heading: optionalText(120),
  body: text(5000),
});

export const ServicesBlock = z.strictObject({
  type: z.literal("services"),
  heading: text(120),
  items: z
    .array(
      z.strictObject({
        name: text(120),
        description: optionalText(500),
        priceCents: PriceCents.optional(),
        duration: optionalText(40),
      }),
    )
    .min(1)
    .max(50),
});

export const MenuBlock = z.strictObject({
  type: z.literal("menu"),
  heading: text(120),
  note: optionalText(300),
  groups: z
    .array(
      z.strictObject({
        name: text(80),
        items: z
          .array(
            z.strictObject({
              name: text(120),
              description: optionalText(300),
              priceCents: PriceCents,
            }),
          )
          .min(1)
          .max(60),
      }),
    )
    .min(1)
    .max(20),
});

export const GalleryBlock = z.strictObject({
  type: z.literal("gallery"),
  heading: optionalText(120),
  images: z.array(Image).min(1).max(40),
});

export const HoursBlock = z.strictObject({ type: z.literal("hours"), heading: optionalText(120) });
export const ContactBlock = z.strictObject({ type: z.literal("contact"), heading: optionalText(120) });

export const FaqBlock = z.strictObject({
  type: z.literal("faq"),
  heading: text(120),
  items: z
    .array(z.strictObject({ question: text(200), answer: text(2000) }))
    .min(1)
    .max(40),
});

export const Block = z.discriminatedUnion("type", [
  HeroBlock,
  NoticeBlock,
  TextBlock,
  ServicesBlock,
  MenuBlock,
  GalleryBlock,
  HoursBlock,
  ContactBlock,
  FaqBlock,
]);
export type Block = z.infer<typeof Block>;
export const BLOCK_TYPES = Block.options.map((o) => o.shape.type.value);

export const Page = z.strictObject({
  slug: z.union([z.literal("index"), Slug]),
  title: text(120),
  seo: z.strictObject({ description: text(300) }),
  blocks: z.array(Block).min(1).max(30),
});
export type Page = z.infer<typeof Page>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Day = z.enum(["pon", "tor", "sre", "čet", "pet", "sob", "ned"]);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Site = z.strictObject({
  id: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/),
  name: text(120),
  tagline: optionalText(200),
  url: z.string().regex(/^https:\/\/[a-z0-9.-]+$/),
  lang: z.literal("sl"),
  contact: z.strictObject({
    phone: optionalText(40),
    email: z.email().optional(),
    address: optionalText(200),
  }),
  hours: z
    .array(
      z.strictObject({
        days: z.array(Day).min(1).max(7),
        open: Time.optional(),
        close: Time.optional(),
        closed: z.boolean().optional(),
        note: optionalText(120),
      }),
    )
    .max(14),
  navigation: z.array(z.strictObject({ label: text(40), href: Href })).max(10),
  theme: z.strictObject({
    colors: z.strictObject({ primary: HexColor, background: HexColor, text: HexColor, accent: HexColor }),
    fonts: z.strictObject({ heading: text(60), body: text(60) }),
  }),
  footerNote: optionalText(300),
});
export type Site = z.infer<typeof Site>;

/** Validates a whole content set; returns human-readable issues (empty array = valid). */
export function validateContent(site: unknown, pages: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const s = Site.safeParse(site);
  if (!s.success) issues.push(...s.error.issues.map((i) => `site.json ${i.path.join(".")}: ${i.message}`));
  if (!("index" in pages)) issues.push("pages: index.json (home page) is required");
  for (const [slug, raw] of Object.entries(pages)) {
    const p = Page.safeParse(raw);
    if (!p.success) {
      issues.push(...p.error.issues.map((i) => `pages/${slug}.json ${i.path.join(".")}: ${i.message}`));
    } else if (p.data.slug !== slug) {
      issues.push(`pages/${slug}.json: slug "${p.data.slug}" must match the file name`);
    }
  }
  return issues;
}

/** "6,50 €" — Slovenian formatting of integer cents. */
export function formatPrice(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  const whole = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole},${rest.toString().padStart(2, "0")} €`;
}

export const DAY_LABELS: Record<z.infer<typeof Day>, string> = {
  pon: "ponedeljek",
  tor: "torek",
  sre: "sreda",
  čet: "četrtek",
  pet: "petek",
  sob: "sobota",
  ned: "nedelja",
};

/** JSON Schemas handed to the editing agent. */
export function contentJsonSchemas() {
  return {
    site: z.toJSONSchema(Site, { io: "input" }),
    page: z.toJSONSchema(Page, { io: "input" }),
  };
}
