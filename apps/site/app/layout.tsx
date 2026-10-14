import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { loadContent } from "@/lib/content";
import "./globals.css";

const { site } = loadContent();

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.name, template: `%s · ${site.name}` },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: site.theme.colors.primary,
};

/** Root layout: only <html>/<body> and the theme. Header and footer live in app/(site)/layout.tsx (ADR-011). */
export default function RootLayout({ children }: { children: ReactNode }) {
  const { colors, fonts } = site.theme;
  const theme = {
    "--c-primary": colors.primary,
    "--c-bg": colors.background,
    "--c-text": colors.text,
    "--c-accent": colors.accent,
    "--f-heading": fonts.heading,
    "--f-body": fonts.body,
  } as CSSProperties;
  return (
    <html lang={site.lang} style={theme}>
      <body>{children}</body>
    </html>
  );
}
