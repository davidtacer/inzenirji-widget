import type { Metadata } from "next";
import { BlockView } from "@/components/Blocks";
import { loadContent } from "@/lib/content";

export function generateMetadata(): Metadata {
  const { pages, site } = loadContent();
  const page = pages.index;
  return { title: { absolute: page?.title ?? site.name }, description: page?.seo.description };
}

export default function HomePage() {
  const { pages, site } = loadContent();
  const page = pages.index;
  if (!page) throw new Error("content/pages/index.json is required");
  return page.blocks.map((block, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no id; the list is static per build
    <BlockView key={`${block.type}-${i}`} block={block} site={site} />
  ));
}
