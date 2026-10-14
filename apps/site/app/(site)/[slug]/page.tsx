import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlockView } from "@/components/Blocks";
import { loadContent } from "@/lib/content";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(loadContent().pages)
    .filter((slug) => slug !== "index")
    .map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = loadContent().pages[slug];
  return page ? { title: page.title, description: page.seo.description } : {};
}

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { pages, site } = loadContent();
  const page = pages[slug];
  if (!page || slug === "index") notFound();
  return page.blocks.map((block, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no id; the list is static per build
    <BlockView key={`${block.type}-${i}`} block={block} site={site} />
  ));
}
