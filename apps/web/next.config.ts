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
  transpilePackages: ["@qvashop/db"],
};

export default withNextIntl(nextConfig);
