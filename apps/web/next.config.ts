import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Single .env at the repo root (Next only reads apps/web/.env by default)
try {
  process.loadEnvFile("../../.env");
} catch {
  // optional: env vars may already be set (CI, Docker)
}

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Self-contained build for Docker; trace from the monorepo root so @qvashop/db is included
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  experimental: {
    // Images are compressed to < 1 MB in the browser; the default Server Action body limit
    // is 1 MB and multipart adds overhead.
    serverActions: { bodySizeLimit: "2mb" },
  },
  allowedDevOrigins: ["*.localhost"],
  transpilePackages: ["@qvashop/db"],
};

export default withNextIntl(nextConfig);
