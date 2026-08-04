import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) has internal dynamic imports that Turbopack's
  // bundler can't statically resolve (verified: it mangled one into a
  // literal "[project]" import specifier). Excluding it from bundling makes
  // Next.js require() it directly from node_modules at runtime instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
