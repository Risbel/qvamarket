# syntax=docker/dockerfile:1
# Build context: repo root. Image: apps/web (Next.js standalone).

FROM node:24-alpine AS base
RUN npm install -g pnpm@12.4.1
WORKDIR /repo

# --- deps: install with the lockfile only (cached unless manifests change)
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

# --- build
FROM base AS builder
COPY --from=deps /repo/ ./
COPY . .
# Placeholders so imports that read env vars at module load don't fail during
# `next build`. Real values are provided at runtime and are NOT baked in.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder \
    BETTER_AUTH_URL=http://localhost:3000 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo/apps/web
RUN pnpm build

# --- runtime
FROM node:24-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# --- migrator: one-off job that applies SQL migrations (not part of the web image).
# Build with: docker build --target migrator -t qvashop-migrate .
# Run with DATABASE_URL set; it exits when done.
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /repo/ ./
COPY packages/db packages/db
WORKDIR /repo/packages/db
CMD ["pnpm", "run", "migrate:run"]
