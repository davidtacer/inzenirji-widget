import type { NextConfig } from "next";

// Static export: the site is plain files served by Cloudflare (ADR-009, ADR-012).
const config: NextConfig = {
  output: "export",
  trailingSlash: false,
  images: { unoptimized: true },
  transpilePackages: ["@inzenirji/site-schema"],
  poweredByHeader: false,
};

export default config;
