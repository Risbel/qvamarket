# QvaShop — Project Context

This file gives full context to anyone (human or AI assistant) working on this repo.
Keep it updated: tick roadmap boxes and add decisions as they happen.

## What we're building

QvaShop is a **B2B2C multi-tenant SaaS** for creating online stores.

- I (the platform owner) sell the platform to businesses.
- A **company** (tenant) can own **several stores**.
- Each store lives on a subdomain: `https://<store-slug>.qvashop.com`.
- Merchants customize their store visually, publish products, receive **orders**, and manage fulfillment (pickup or home delivery).
- In the MVP, the superadmin (me) can do everything on behalf of a merchant, including creating their account.
- **No online payments in the MVP.** Payment is settled between merchant and customer outside the platform (cash, transfer, etc.); the merchant records it manually on the order.

**MVP goal:** 3–5 real merchants selling. Nothing else matters until that happens.

## Stack (decided — do not change without a strong reason)

| Area | Choice |
|---|---|
| Monorepo | pnpm workspaces |
| Web app | Next.js (App Router, TypeScript, `src/` dir) — storefront + merchant panel + admin in one app |
| UI | Tailwind CSS + shadcn/ui |
| i18n | next-intl — locales `es` (default) and `en` |
| Forms / validation | react-hook-form + zod, connected with `@hookform/resolvers` (`zodResolver`) |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Better Auth (email + password, organizations, admin/impersonation plugins) |
| File storage | S3-compatible: **SeaweedFS** in Docker (MinIO's official images are no longer published; any S3 server works, only the env vars change) |
| Hosting | Single VPS (Hostinger) + Dokploy, everything in Docker |
| DNS / SSL | Cloudflare, wildcard `*.qvashop.com` |

## Repo structure

```
qvashop/
├── CLAUDE.md               # this file
├── pnpm-workspace.yaml
├── apps/
│   └── web/                # Next.js app
│       ├── messages/       # es.json, en.json
│       └── src/
│           ├── app/[locale]/
│           ├── components/ui/   # shadcn components
│           ├── i18n/            # routing.ts, request.ts, navigation.ts
│           └── proxy.ts         # locale (and later tenant) routing
├── docker-compose.yml      # local PostgreSQL
├── Dockerfile              # production image for apps/web (build context: repo root)
├── .env.example
└── packages/
    └── db/                 # @qvashop/db: Drizzle schema + migrations
```

## Domains and routing

| Host | Purpose |
|---|---|
| `qvashop.com` | Marketing / landing |
| `app.qvashop.com` | Merchant panel |
| `admin.qvashop.com` | Superadmin panel |
| `<slug>.qvashop.com` | Public storefront |

- `proxy.ts` (Next.js 16; was `middleware.ts` before) reads the `host` header, resolves the store by slug, and rewrites internally. It also handles locale routing via next-intl.
- **Reserved slugs** that merchants cannot use: `www`, `app`, `admin`, `api`, `mail`, `static`, `assets`, `status`, `help`, `docs`.
- `ROOT_DOMAIN` env var (hostname only): `localhost` in dev, `qvashop.com` in prod. `src/lib/tenancy.ts` extracts the store slug from the host and holds the reserved slugs.
- Store hosts are rewritten to the internal route `/[locale]/stores/[slug]/...` (direct access to `/stores/...` on other hosts returns 404). Phase 0 does not look the slug up; Phase 1 resolves it against the `stores` table. `app.` / `admin.` hosts are not routed separately yet.
- Local development: use `*.localhost` (e.g. `http://mitienda.localhost:3000`), which resolves to 127.0.0.1 in modern browsers without editing the hosts file.

## Architecture decisions

### Multi-tenancy
- **One shared PostgreSQL database** for the MVP. Every tenant-owned table has a `tenant_id` column.
- Data model: **Company (tenant) → Stores → Products / Orders**. The company is the unit of isolation and billing; the store is the unit of catalog and branding.
- All IDs are **UUIDs (v7 preferred)**, never auto-increment, so a tenant's data can later be copied to another database without collisions.
- **A company (tenant) is a Better Auth `organization`** (plugin enabled in `apps/web/src/lib/auth.ts`). `tenant_id` on any table = `organization.id`; merchant users are `member`s of it. No separate `companies` table.
- App tables live in `packages/db/src/app-schema.ts` (auth tables stay in the generated `auth-schema.ts`). Done so far: `store` (`tenant_id`, globally unique `slug` with a DB format check, `name`, `is_active`). The `invitation` table exists because the plugin requires it but is unused (no email in the MVP).
- **Catalog tables** (`app-schema.ts`): `product` (`tenant_id`, `store_id`, `name`, `description`, `price_minor` integer minor units, `stock` nullable = not tracked, `status` draft | active | archived) and `product_image` (`storage_key`, `content_type`, `size_bytes`, `position` where 0 is the main image). The currency lives on the store (`store.currency`, ISO 4217, default USD), not on each product.
- **Cross-tenant integrity is enforced by the database:** children carry `tenant_id` plus a **composite FK** to the parent's `(id, tenant_id)` (`product` -> `store`, `product_image` -> `product`), so a row can never point at another tenant's parent. Do the same for every new tenant-owned table. Deleting a store/product cascades to rows only: **the code must also `deleteObject()` the image files**.
- Every query must be scoped by tenant. Never write a query on tenant data without a `tenant_id` filter.
- Future (not MVP): Postgres Row Level Security, and a tenant registry with a per-tenant connection string so large tenants can be moved to a dedicated database.

### Auth and accounts
- Passwords are **hashed** by Better Auth. Never store plaintext or reversibly encrypted passwords.
- The superadmin creates merchant accounts with a temporary password and a `mustChangePassword` flag; the merchant must change it on first login. The flag is a Better Auth additional field (`input: false`, so users cannot set it) and is cleared server-side after the password change.
- **Forced password change:** while `mustChangePassword` is true, `requireUser()` (`src/server/session.ts`) and `requireAdminPage()` redirect to `/[locale]/change-password`, and `getAdminSession()` refuses the session. **Every protected page/layout must use `requireUser()` or `requireAdminPage()`** so the change cannot be skipped. `changePasswordAction` verifies the current password through Better Auth, revokes other sessions, then clears the flag.
- **Password reset (MVP recovery):** `resetMerchantPassword()` (button + dialog in the admin list) sets `mustChangePassword` first, then a new temporary password, then revokes all of the merchant's sessions; the credentials are shown once and forgotten when the dialog closes. It refuses admin accounts (`notFound`), so a superadmin password can never be reset this way.
- **Impersonation:** `startImpersonation()` / `stopImpersonation()` (`src/server/impersonation.ts`, buttons in the admin list and a banner on the merchant dashboard). Every start/stop is a row in `impersonation_log` (admin, target, tenant, IP, user agent; emails snapshotted, FKs `SET NULL` so the trail survives deletions). The log row is written **before** the session is created and removed if that fails, so an unlogged impersonation cannot exist. Admin accounts cannot be impersonated; an impersonated session is a normal merchant session (`/admin` returns 404), so impersonations cannot be nested; sessions last 30 min. While impersonating, the forced password change is skipped (both `requireUser` and `requireAdminPage` check `session.impersonatedBy`). **Every signed-in layout must render `<ImpersonationBanner>` when `session.session.impersonatedBy` is set** (only the dashboard does so far; the merchant panel layout must too).
- **Rate limiting:** Better Auth limits `/sign-in/email` to 3 requests per 10 s per IP in production builds (the window resets after 10 s without requests); the login form shows a specific message on 429. **Deploy note:** behind Cloudflare + Traefik set `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]` in `auth.ts`, otherwise all visitors share one counter.
- Superadmin logic lives in `apps/web/src/server/`: `getAdminSession(headers)` (role `admin`, not banned — every superadmin action must call it first), `createMerchant()` (user + company/organization with the user as owner + first store; compensates by deleting created rows if a step fails), `generateTemporaryPassword()`. Merchant users have role `user`; only the superadmin has role `admin`.
- Superadmin UI (path-based for now; the `admin.` host is not routed separately yet): `/[locale]/admin` (all stores with company + owner) and `/[locale]/admin/merchants/new` (create merchant form + one-time credentials card). `requireAdminPage()` guards the layout (anonymous -> login, non-admin -> 404); `createMerchantAction` re-validates and re-checks the admin role on the server.
- Password recovery in the MVP: the superadmin resets it manually. No email provider.
- Superadmin can impersonate a merchant; every impersonation is logged.
- Config lives in `apps/web/src/lib/auth.ts` (email+password, `admin` plugin). The `organization` plugin is added in Phase 1 when companies/stores exist.
- Auth tables live in `packages/db/src/auth-schema.ts`, **generated** by the Better Auth CLI (do not hand-edit; regenerate after changing plugins/config). IDs are UUIDs generated by PostgreSQL (`gen_random_uuid()`, v4 — PG 17 has no native v7).
- Create the first superadmin with the CLI (see Useful commands). Pages: `/[locale]/login`, `/[locale]/dashboard` (protected placeholder).

### Orders (planned structure — no code yet)
Orders are created at storefront checkout (guest checkout, no customer account). Merchants manage them in the panel.

| Table | Purpose / key fields |
|---|---|
| `customers` | Per tenant. Name, phone, email (optional). Guest checkout creates/reuses by phone. |
| `orders` | `tenant_id`, `store_id`, `customer_id`, `number` (human-readable, unique per store), `status`, `payment_status`, `fulfillment_type` (`pickup` \| `delivery`), `subtotal`, `delivery_fee`, `total`, `currency`, `customer_note`, timestamps |
| `order_items` | `order_id`, `product_id` (nullable ref), **snapshot** of name, unit price, qty, line total. Never read live product price for an existing order. |
| `order_status_history` | `order_id`, `from_status`, `to_status`, actor (user / system / customer), note, timestamp. Audit trail; written on every status change. |
| `order_payments` | Manual records: `method` (cash, transfer, other), `amount`, `paid_at`, `recorded_by`, note. No gateway involved. |
| `order_delivery` | 1:1 with delivery orders: snapshot of address, contact phone, zone, fee, scheduled slot. Filled by the delivery flow (Phase 5). |

- **Order status:** `pending → confirmed → preparing → ready → out_for_delivery → completed`, plus `cancelled` from any non-final state. `out_for_delivery` only applies to `delivery` orders.
- **Payment status:** `unpaid | partial | paid | refunded` — derived from `order_payments`, not edited directly.
- **Money:** integer minor units (e.g. cents) + currency code. Never floats.
- Order totals are computed server-side at checkout; the client never sends prices.

### Home delivery (to be designed in Phase 5)
Merchant configures per store: delivery on/off, pickup on/off, delivery zones, fee per zone, minimum order, optional schedule/slots. Checkout reads this config and fills `order_delivery`. Open decision at that point: zones by neighborhood/municipality list vs. radius, flat vs. variable fees.

### File storage
- `docker-compose.yml` runs SeaweedFS (`chrislusf/seaweedfs:4.48`, S3 API on port 8333). One bucket (`S3_BUCKET`, created on first use) with **public read** (anonymous identity) and write/delete only with the access key. Env: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL` (see `.env.example`). Use a strong secret outside local dev.
- Code: `apps/web/src/server/storage.ts` (`putObject`, `deleteObject`, `publicUrl`, `tenantKey`). **Every key must be built with `tenantKey(tenantId, ...)`** (`tenants/<tenantId>/...`), so each company's files live under its own prefix. File names include a random UUID and are never overwritten (served with `immutable` cache headers). Uploads go through our server (validate type/size, check the user's tenant), never straight from the browser.

### Deployment image
- `Dockerfile` (repo root context) builds `apps/web` with Next `output: "standalone"`; runs `node apps/web/server.js` as non-root on port 3000.
- Build uses **placeholder** `DATABASE_URL` / `BETTER_AUTH_SECRET` only so `next build` can import modules; real values are runtime env vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ROOT_DOMAIN`).
- Migrations: separate Dockerfile target `migrator` (`docker build --target migrator -t qvashop-migrate .`), a one-off job that runs `packages/db/src/migrate.ts` against `DATABASE_URL` and exits. Idempotent; run it on every deploy before starting the web app. Locally: `pnpm --filter @qvashop/db migrate:run`.

### Forms and validation
- All forms use **react-hook-form** with a **zod** schema through `zodResolver`, for field-level feedback and flexible validation (refinements, cross-field rules).
- Define each schema once and reuse it on the server (Server Actions / route handlers must re-validate with the same schema; never trust client validation).
- Validation messages are translated: build schemas with a factory that receives the `next-intl` translator, and keep message keys in `es.json` and `en.json`.
- Use the shadcn `Form`/`Field` components with react-hook-form where available, so errors, labels and `aria-*` stay consistent.
- Every form must use `method="post"` and keep its submit button disabled until hydrated (`useHydrated()` from `@/lib/use-hydrated`). Otherwise a submit before hydration is a native GET that puts the fields (including passwords) in the URL.
- Existing forms written with plain state (e.g. login) should be migrated when they are next touched.

### i18n
- Never hardcode UI text. All strings go in `apps/web/messages/es.json` and `en.json`, with the same keys in both.
- Never put raw `<` or `>` in message strings: next-intl (ICU) parses `<name>` as a rich-text tag and throws `INVALID_MESSAGE`. Pass such text as a placeholder value (`{url}`) instead.
- Use `Link`, `redirect`, `useRouter` from `@/i18n/navigation`, not from `next/link` / `next/navigation`.

## Roadmap

Rule: **don't start a phase until the previous one is done.** New ideas go to the Parking Lot, not into the code.

### Phase 0 — Base
- [x] Repo created on GitHub, cloned locally, pnpm monorepo
- [x] Next.js app in `apps/web`
- [x] shadcn/ui
- [x] next-intl (es, en)
- [x] PostgreSQL in Docker (`docker-compose.yml`) + Drizzle in `packages/db`
- [x] Better Auth with login
- [x] Subdomain routing in `proxy.ts`
- [ ] Deploy to VPS with Dokploy + wildcard `*.qvashop.com`

> **Decision (2026-10):** the VPS deploy is deferred until the product is further along. Phases 1–3 are built and tested locally (`*.localhost`). Plan for when we deploy: Hostinger **KVM 2** (2 vCPU, 8 GB) with Dokploy, domain on Cloudflare. The `Dockerfile` and `migrator` target are already tested locally.

✅ Done when: `prueba.qvashop.com` shows "Hola, tienda prueba".

### Phase 1 — Superadmin panel
- [x] Create companies, stores and users (temporary password)
- [x] Reset passwords
- [x] Impersonate a merchant (logged)

✅ Done when: I can create a complete merchant in 2 minutes.

### Phase 2 — Merchant panel
- [ ] Products with images (MinIO)
- [ ] Store branding: logo, colors

✅ Done when: a merchant loads 10 products on their own.

### Phase 3 — Public storefront
- [ ] Catalog, product page, cart
- [ ] Checkout that creates an order (pickup only for now)

✅ Done when: a customer can create an order.

### Phase 4 — Orders management
- [ ] Orders schema (customers, orders, items, status history, payments)
- [ ] Merchant order list + detail
- [ ] Status changes with history
- [ ] Manual payment recording

✅ Done when: a merchant processes an order from `pending` to `completed`.

### Phase 5 — Home delivery
- [ ] Delivery configuration flow per store (zones, fees, minimum, slots, pickup toggle)
- [ ] Checkout supports delivery (address, zone fee, slot)
- [ ] Delivery info in the merchant order view

✅ Done when: a customer orders with home delivery and the merchant sees address, fee and slot.

### Phase 6 — Pilot
- [ ] 3–5 real merchants using it

## Parking Lot (NOT in the MVP)

- Online payments of any kind:
  - Crypto: USDT on BNB Smart Chain, non-custodial to the merchant wallet, unique-amount matching, payment watcher worker (viem + BullMQ)
  - Swap at checkout (pay with other tokens → merchant receives USDT)
  - Card / PayPal / Apple Pay / Google Pay via an on-ramp commerce provider
  - Payment router smart contract + platform fee split
- Outgoing webhooks for merchants (HMAC signed)
- Telegram bot: order notifications and password recovery
- Recovery codes for accounts
- Row Level Security + dedicated databases for large tenants
- Custom domains for stores
- Customer accounts / order tracking page
- More languages

## Conventions

- **Commits:** one commit per finished feature, Conventional Commits:
  - `feat:` new feature · `fix:` bug fix · `chore:` config/tooling · `docs:` documentation · `refactor:` no behavior change
  - Scope when useful: `feat(web): ...`, `feat(db): ...`
- TypeScript strict. No `any` unless justified in a comment.
- Package manager: **pnpm only**.
- Secrets in `.env` (never committed). Keep `.env.example` updated.

## Working style (for AI assistants)

- Work in **small steps**. One feature at a time, then stop.
- Give **short, numbered instructions**. Avoid long explanations unless asked.
- Ask before adding a new dependency or changing anything in "Stack" or "Architecture decisions".
- Do not build anything from the Parking Lot unless explicitly asked.
- After each finished feature, suggest the commit message and remind to tick the roadmap box here.
- The owner communicates in Spanish and English; reply in the language of the message.

## Useful commands

```bash
pnpm install                 # install all workspaces
pnpm --filter web dev        # run the web app (localhost:3000)
pnpm --filter web build      # production build
docker compose up -d         # start local PostgreSQL
docker build -t qvashop-web:local .   # production image (Next standalone, ~300 MB)
pnpm --filter @qvashop/db check     # test DB connection
pnpm --filter @qvashop/db generate  # generate migration from schema
pnpm --filter @qvashop/db migrate   # apply migrations
pnpm dlx shadcn@latest add <component>   # run inside apps/web

# Better Auth (run inside apps/web, with the root .env loaded: `set -a; . ../../.env; set +a`)
pnpm dlx auth@latest generate --config src/lib/auth.ts --adapter drizzle --dialect pg --output ../../packages/db/src/auth-schema.ts -y
#   then: pnpm --filter @qvashop/db generate && pnpm --filter @qvashop/db migrate
pnpm dlx auth@latest create-admin --config src/lib/auth.ts --email <email> --name <name>   # prompts for password
```
