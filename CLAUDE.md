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
| Image compression | `browser-image-compression` in the browser: every product image is shrunk to a WebP **under 1 MB** (max 1600 px) before upload |
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
- Store hosts are rewritten to the internal route `/[locale]/stores/[slug]/...` (direct access to `/stores/...` on other hosts returns 404). The storefront page resolves the slug against the `store` table (`getPublicStoreBySlug`): unknown or inactive stores return 404 (so `prueba.qvashop.com` needs a store with slug `prueba`, created from the admin panel). `app.` / `admin.` hosts are not routed separately yet.
- Local development: use `*.localhost` (e.g. `http://mitienda.localhost:3000`), which resolves to 127.0.0.1 in modern browsers without editing the hosts file.

## Architecture decisions

### Multi-tenancy
- **One shared PostgreSQL database** for the MVP. Every tenant-owned table has a `tenant_id` column.
- Data model: **Company (tenant) → Stores → Products / Orders**. The company is the unit of isolation and billing; the store is the unit of catalog and branding.
- All IDs are **UUIDs (v7 preferred)**, never auto-increment, so a tenant's data can later be copied to another database without collisions.
- **A company (tenant) is a Better Auth `organization`** (plugin enabled in `apps/web/src/lib/auth.ts`). `tenant_id` on any table = `organization.id`; merchant users are `member`s of it. No separate `companies` table.
- App tables live in `packages/db/src/app-schema.ts` (auth tables stay in the generated `auth-schema.ts`). Done so far: `store` (`tenant_id`, globally unique `slug` with a DB format check, `name`, `currency`, `status`, branding: `logo_key`, `primary_color`, `accent_color`). The `invitation` table exists because the plugin requires it but is unused (no email in the MVP).
- **Catalog v2 (decided 2026-10, migrations `0008`–`0010`)** — modeled after Shopify/Medusa/Saleor:
  - `currency` (platform table, seeded from `Intl.supportedValuesOf("currency")`: code PK, name, `digits`, `is_active`) and `store_currency` (which currencies a store sells in, `is_default` = exactly one, `position`). `store.currency` no longer exists. `setStoreCurrencies()` refuses to remove a currency that still has prices (`inUse`).
  - `category`: one optional category per product (`product.category_id`, FK `ON DELETE SET NULL ("category_id")` so `tenant_id` is kept), `slug` unique per store (used as the storefront `#anchor`), `position`, `is_visible`, meta fields, `parent_id` reserved (UI is flat).
  - `product`: no price or stock any more; `slug` (unique per store, URL `/products/<slug>`, old id URLs redirect permanently), `tags text[]` (GIN), `meta_title`, `meta_description`.
  - **Variants:** `product_option`, `product_option_value`, `product_variant` (`sku` unique per tenant, `stock` null = not tracked, `weight_grams`, `option_key`), `variant_option_value`. **Every product has exactly one hidden default variant** (`is_default`, empty `option_key`) when it has no visible variants, so price, stock, cart and orders always work on variants (one code path). The cart stores `{ variantId, quantity }`.
  - **Prices:** `variant_price` (`currency_code`, `min_quantity` ≥ 1 for volume tiers, `amount_minor` **bigint**, `compare_at_minor` > amount = strike-through price, `price_list_id` null = regular price). `price_list` (`kind` sale | override, `status` draft | active, `starts_at`/`ends_at`) holds dated promotions. Resolution in `src/lib/pricing.ts` (`resolvePrice`, unit tested): the regular row with the highest `min_quantity` ≤ qty; an active in-date `sale` applies only if cheaper, an `override` always. **No automatic currency conversion:** a product is only sold in a currency where it has a regular price at qty 1 (otherwise it is hidden in that currency).
  - `store` profile columns: `description`, `phone`, `whatsapp`, `contact_email`, `address`, `pickup_instructions`, `opening_hours` (jsonb, no UI yet), `meta_title`, `meta_description`.
  - `product_image` unchanged (`storage_key`, `content_type`, `size_bytes`, `position` 0 = main image).
  - Hand edits in generated migrations: `0008` (unique constraint moved before the composite FKs that need it, column-list `SET NULL`, currency seed + data backfill), `0010` (hand-written: `variant_price_store_currency_fk` is `DEFERRABLE INITIALLY DEFERRED`, otherwise deleting a store/company with prices fails mid-cascade; drizzle-kit cannot express it).
- **Cross-tenant integrity is enforced by the database:** children carry `tenant_id` plus a **composite FK** to the parent's `(id, tenant_id)` (or `(id, store_id, tenant_id)` for variants and prices), so a row can never point at another tenant's parent. Do the same for every new tenant-owned table. Deleting a store/product cascades to rows only: **the code must also `deleteObject()` the image files**.
- **Drizzle gotcha:** inside a raw `sql` subquery in a *single-table* select, `${table.column}` can be rendered without the table name and silently bind to the subquery's table (this made every category count 0). Use a join + `groupBy`, or only use correlated subqueries in queries that already join.
- **Merchant panel** (`/[locale]/dashboard/...`, path-based for now; it moves to `app.` later): `dashboard/layout.tsx` renders the header (store, company, nav) and the impersonation banner. **Every merchant page and Server Action starts with `requireMerchant(locale)`** (`src/server/tenant.ts`: signed in + past the forced password change + member of a company with a store, else 404) and passes the returned `tenantId` / `store.id` to the query helpers in `src/server/*.ts` (e.g. `products.ts`), which always filter by `tenant_id`. Never take a tenant or store id from client input. MVP: the active store is the company's oldest store (no switcher yet). `requireMerchant()` returns `store.currencies` and `store.defaultCurrency`; prices are shown with `formatMoney(minor, currencyCode, locale)` (`src/lib/money.ts`) or `<PriceTag>` (strike-through compare-at).
- **Products (merchant panel):** pages `/dashboard/products`, `/new`, `/[id]/edit`; form = react-hook-form + zod (`createProductSchema(t, currencies)` in `lib/validation/product.ts`): name, description, category, status, **one price card per store currency** (price required only in the default currency, optional compare-at, up to 5 volume tiers), SKU, stock, SEO (slug auto-filled from the name, tags, meta title/description). Prices are decimal strings converted to minor units on the server with `toProductInput()` / `parsePriceToMinor()` (string arithmetic, no floats); `form-values.ts` maps saved rows back. Empty stock = not tracked (null). A product with real variants (more than 1) can only have its general fields edited here (`hasVariants`); its prices/stock belong to the variants editor (Part 2, not built).
- **Categories** (`/dashboard/categories`, `category:update`): create (slug auto from the name), rename, show/hide, move up/down, delete (its products stay, without category). **Settings** (`/dashboard/settings`, `store:update`): store currencies (add, remove, choose the default) and the public profile / pickup instructions. Both use `src/server/catalog-actions.ts` (same `getMerchantOrNull` + `can()` + re-validation pattern).
- **Storefront catalog:** sticky category index (`#<category-slug>` anchors, merchant order, hidden categories excluded; uncategorized products go to `#_otros`), sale / sold-out badges, volume tiers on the product page. **Shopper currency** = host-only cookie `qvashop_currency` set by `<CurrencySwitcher>` (only shown with 2+ currencies) and validated on the server (`selectedCurrency()` in `src/server/storefront-currency.ts`); the server prices everything, including the cart (`priceCart`, tiers applied per quantity). Checkout must re-price the same way. **Server Actions** (`src/server/product-actions.ts`) use `getMerchantOrNull()` (never throws/redirects), answer `forbidden` when `can({ product: [...] })` is false, re-validate with the same schema, and call tenant-scoped helpers in `src/server/products.ts` (update/delete match `id` AND `tenant_id` AND `store_id`; another company's id is a 404/`notFound`). `deleteProduct` removes the rows and then the image files from storage.
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
- Config lives in `apps/web/src/lib/auth.ts` (email+password, `admin` and `organization` plugins).
- Auth tables live in `packages/db/src/auth-schema.ts`, **generated** by the Better Auth CLI (do not hand-edit; regenerate after changing plugins/config). IDs are UUIDs generated by PostgreSQL (`gen_random_uuid()`, v4 — PG 17 has no native v7).
- Create the first superadmin with the CLI (see Useful commands). Pages: `/[locale]/login`, `/[locale]/change-password`, `/[locale]/dashboard` (merchant panel), `/[locale]/admin` (superadmin).

### Roles and permissions (decided 2026-10)
- **Three kinds of identity, one global Better Auth `user` table:**
  1. **Superadmin** (platform role `admin`, admin plugin): only the owner of the platform. Not tenant data.
  2. **Merchant team** (company role via the `organization` plugin): `owner` (everything), `manager` (store read/update, products all, orders read/update; no team management), `staff` (store read, products read, orders read/update; no catalog edits, no settings).
  3. **Customers**: no company membership; a `customer` record per company (see below). A customer can never open the merchant panel or the admin panel (both require membership / role).
- **Permissions are resource + action pairs**, defined once in `src/lib/permissions.ts` (Better Auth access control: `createAccessControl`). Resources: `store` (read, update), `product` (read, create, update, delete), `category` (read, create, update, delete; staff: read), `order` (read, update), plus the plugin's `organization` / `member` / `invitation`. Adding a feature = adding its resource/actions there and granting them to roles.
- **Pages and Server Actions check permissions, not role names:** `requireMerchant(locale)` returns `can({ product: ["update"] })`; pages call `notFound()` and actions return `forbidden` when it is false. Never write `role === "owner"` in feature code. Hiding a button is not authorization: re-check on the server.
- **Implemented:** `src/lib/permissions.ts` (statements, roles, `can(roleString, request)`), the `organization` plugin is configured with them in `auth.ts`, `requireMerchant()` returns `can()`, `requireMerchantPermission(locale, request)` guards pages (404 when missing), the panel nav and home card only show what the role allows. A role name that is not defined (e.g. `viewer`, or Better Auth's old `member`/`admin`) grants nothing. In the admin list the company contact is its **oldest member** (not matched by role).
- Company roles may be combined (`"manager,staff"` is supported). Roles defined by each company at runtime (Better Auth *dynamic access control*) are possible later without changing call sites (move `can()` to `auth.api.hasPermission`); not built now.

### Merchant signup (decided 2026-10)
- Merchants can register themselves (`/[locale]/signup`): the form creates the user (own password, no forced change), the company and the first store. **The store starts `pending`**: the merchant can log in and set up (products, branding) but the storefront is not public until the superadmin approves it in the admin panel (store `status`: pending | active | suspended, replacing `is_active`). The superadmin can still create merchants by hand.
- No email provider in the MVP: emails are not verified and recovery stays manual, so signup needs rate limiting (and a captcha/honeypot) before it is opened to the public.

- **Implemented:** `/[locale]/signup` (linked from the home and login pages) -> `signupAction` -> `registerMerchant()` (`src/server/signup.ts`): user with their own password (no forced change, email NOT verified), company with the user as owner, first store with status `pending`, and the user is signed in. Shares `findUnavailable` / `createCompanyAndStore` / `removeUser` (`src/server/provisioning.ts`) with the superadmin's `createMerchant`, which creates stores `active`.
- **Store status** (`store.status`, DB CHECK): `pending` (default) -> not public; `active` -> public; `suspended` -> not public again. The storefront only serves `active` stores (404 otherwise); the merchant panel keeps working in every status and shows a banner while the store is not active. The superadmin approves / suspends / reactivates in the admin list (pending stores are listed first); changes are not audited yet.
- **Abuse protection on signup** (no email verification yet): per-IP limits (`SIGNUP_MAX_ATTEMPTS`, default 10 per hour, and `SIGNUP_MAX_ACCOUNTS`, default 3 per day; in-memory sliding window in `src/server/rate-limit.ts`, resets on restart), a honeypot field and a minimum fill time of 1.5 s (client-reported, only a speed bump), plus the manual approval, which is the real gate.

### Customer accounts (decided 2026-10)
- **One global account, one `customer` record per company.** Signing up or logging in from a store's storefront creates the `customer` row (`tenant_id`, `user_id`) for that company if it does not exist. The planned `customers` table (guest checkout, by phone) gets a nullable `user_id`; guest orders can be linked to the account later.
- **Branded login/signup on the store's own subdomain** (`<slug>.qvashop.com/login`, `/signup`): reached from the QR code / store link, shows the merchant's logo and colors (from store branding, Phase 2), and returns to the same store after authenticating. The customer never leaves the store's domain.
- Session cookies stay **host-only** (no `crossSubDomainCookies`): a session on one store is not sent to another store or to `app.`/`admin.`. The same person signs in once per store with the same credentials.
- Open technical point to verify when building it: Better Auth `baseURL`/trusted origins must accept every store subdomain (wildcard `*.<root domain>`).

### Orders (planned structure — no code yet)
Orders are created at storefront checkout (guest checkout, no customer account). Merchants manage them in the panel.

| Table | Purpose / key fields |
|---|---|
| `customers` | Per tenant. Name, phone, email (optional). Guest checkout creates/reuses by phone. |
| `orders` | `tenant_id`, `store_id`, `customer_id`, `number` (human-readable, unique per store), `status`, `payment_status`, `fulfillment_type` (`pickup` \| `delivery`), `subtotal`, `delivery_fee`, `total`, `currency`, `customer_note`, timestamps |
| `order_items` | `order_id`, `variant_id` / `product_id` (nullable refs), **snapshot** of name, variant title, SKU, unit price (after tiers/promotions), compare-at, qty, line total. Never read live product price for an existing order. |
| `order_status_history` | `order_id`, `from_status`, `to_status`, actor (user / system / customer), note, timestamp. Audit trail; written on every status change. |
| `order_payments` | Manual records: `method` (cash, transfer, other), `amount`, `paid_at`, `recorded_by`, note. No gateway involved. |
| `order_delivery` | 1:1 with delivery orders: snapshot of address, contact phone, zone, fee, scheduled slot. Filled by the delivery flow (Phase 5). |

- **Order status:** `pending → confirmed → preparing → ready → out_for_delivery → completed`, plus `cancelled` from any non-final state. `out_for_delivery` only applies to `delivery` orders.
- **Payment status:** `unpaid | partial | paid | refunded` — derived from `order_payments`, not edited directly.
- **Money:** integer minor units (e.g. cents) + currency code, `bigint` columns (currencies like CUP reach large amounts). Never floats.
- Order totals are computed server-side at checkout; the client never sends prices.

### Home delivery (to be designed in Phase 5)
Merchant configures per store: delivery on/off, pickup on/off, delivery zones, fee per zone, minimum order, optional schedule/slots. Checkout reads this config and fills `order_delivery`. Open decision at that point: zones by neighborhood/municipality list vs. radius, flat vs. variable fees.

### File storage
- `docker-compose.yml` runs SeaweedFS (`chrislusf/seaweedfs:4.48`, S3 API on port 8333). One bucket (`S3_BUCKET`, created on first use) with **public read** (anonymous identity) and write/delete only with the access key. Env: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL` (see `.env.example`). Use a strong secret outside local dev.
- Code: `apps/web/src/server/storage.ts` (`putObject`, `deleteObject`, `publicUrl`, `tenantKey`). **Every key must be built with `tenantKey(tenantId, ...)`** (`tenants/<tenantId>/...`), so each company's files live under its own prefix. File names include a random UUID and are never overwritten (served with `immutable` cache headers). Uploads go through our server (validate type/size, check the user's tenant), never straight from the browser.

### Product images (decided 2026-10)
- **Hard limit: each stored image is under 1 MB** (`MAX_IMAGE_BYTES = 1_000_000`), max **6 images per product**, JPEG/PNG/WebP only. Constants and the type/size checks live in `src/lib/images.ts`.
- **Browser** (`src/lib/compress-image.ts`, `browser-image-compression`): resizes to at most 1600 px on the long side and re-encodes to WebP targeting 0.9 MiB (**JPEG instead where the browser cannot encode WebP**, notably Safari, which silently returns PNG; detected at runtime with `canEncodeWebp()`); originals up to 20 MB are accepted for compression. Re-encoding through a canvas also strips EXIF (GPS, camera). `useWebWorker: false` on purpose: the library's default worker is downloaded from cdn.jsdelivr.net at runtime, and we do not run third-party code on merchants' pages.
- **Server** (`src/server/product-image-actions.ts` -> `product-images.ts`) never trusts the client: it re-checks size (> 1 MB is refused), detects the real type from the file's magic bytes (the browser-reported type and file name are ignored; SVG/HTML are refused), requires `product:update`, and derives the key extension from the detected type. Uploads are Server Actions with `experimental.serverActions.bodySizeLimit: "2mb"` in `next.config.ts` (the default is 1 MB and multipart adds overhead).
- **Consistency:** the file is uploaded first and the row inserted second (inside a transaction that locks the product row, so simultaneous uploads cannot exceed the limit); if recording fails the file is removed. Deleting an image removes the row, repacks positions (the next image becomes main) and then deletes the file. `deleteProduct` removes all its files. Keys: `tenants/<tenantId>/products/<productId>/<uuid>.<ext>`.
- **Deleting a whole company must also delete its `tenants/<tenantId>/` prefix in storage** (a database cascade only removes rows). Not implemented yet because there is no delete-company feature.
- Images are shown with a plain `<img>` pointing at the public bucket URL (`publicUrl(key)`); `next/image` is not used (it would need `sharp` and a remote host config for the bucket).

### Public storefront (Phase 3)
- Internal routes under `/[locale]/stores/[slug]/` (reached through the subdomain rewrite in `proxy.ts`): `layout.tsx` (resolves the store, 404 unless `active`, sets the brand CSS variables, header), `page.tsx` (catalog) and `products/[id]/page.tsx` (product page: gallery, price, description, stock hint). Public URLs: `<slug>.qvashop.com/es` and `<slug>.qvashop.com/es/products/<product-slug>` (an id in that segment redirects to the slug).
- **Public reads** live in `src/server/public-store.ts` (store by slug) and `src/server/public-catalog.ts` (products). They run without a signed-in tenant, so safety is in the query: a product is joined to its store by the composite key (`store_id`, `tenant_id`), and only `active` products of `active` stores are returned (draft, archived, pending and suspended do not exist for the public). `tenant_id` never leaves these files. Add any new public read there, with the same rules.
- Visitors see: `stock = 0` -> "Agotado" badge; `stock` 1 to 5 -> "Quedan solo N"; untracked stock (null) -> nothing. Descriptions are plain text (React escapes it, line breaks kept): never render merchant text as HTML.
- Storefront pages use the brand only through CSS variables (`var(--brand)`, `--brand-accent`, and their `-foreground` pairs); the price stays neutral so a light brand color never hurts readability.

### Cart (Phase 3)
- **The cart lives in the browser** (localStorage key `qvashop:cart:v2:<storeId>`; each store subdomain is its own origin, so carts are separate) and holds **only `{ variantId, quantity }`** (`src/lib/cart.ts`). Names, prices and stock are never stored: a tampered cart cannot change a price. `parseCart` drops anything invalid (bad ids, quantities out of 1..99, extra fields such as a price), merges duplicates and caps the cart at 50 lines.
- **The server is the only source of amounts:** `priceCartAction(slug, currency, items)` -> `priceCart(storeId, currencyCode, items)` (`src/server/cart.ts`) re-reads each variant, resolves its unit price for the quantity (volume tiers, active sales) with the public rules (active product in an active store), applies the stock (`null` = up to 99) and returns per-line `status`: `ok`, `reduced` (asked for more than the stock; quantity lowered), `soldOut`, `unavailable` (hidden, deleted, another store's, or no price in the chosen currency: no name is revealed for the first three), plus the subtotal. Invalid entries are skipped one by one, never failing the whole cart. Rate limited per IP (120 per minute). **Checkout must call `priceCart` again and never trust any amount from the browser.**
- Cart page (`/cart` on the store subdomain): shows what the customer has with the prices the server sent, updates instantly on +/-/remove and re-prices right after; a quantity the server lowered keeps an explanation ("Solo quedan N") until the customer touches that line. Product pages offer a quantity picker limited to the free stock (stock minus what is already in the cart); sold-out products have no add button. The header shows the unit count and follows other tabs (`storage` event).
- Known quirk: the header counter comes from storage, so it also counts lines that turn out to be unavailable until the customer opens the cart and removes them.
- Money: a cart can reach 50 lines x 99 units x 10 000 000 major units, so **order totals must be stored as bigint**, not PostgreSQL `integer`.

### Store branding (decided 2026-10)
- Per store: a **logo** (`store.logo_key`, storage key under `tenants/<tenantId>/stores/<storeId>/logo/`), a **primary color** and an **accent color** (`#rrggbb`, lowercase, enforced by DB CHECKs; null = platform default `DEFAULT_PRIMARY` / `DEFAULT_ACCENT` in `src/lib/color.ts`). Edited at `/dashboard/branding` with a live preview; needs `store:update` (owner, manager).
- **Logo upload** reuses the product-image pipeline (browser compression, server re-check, real-type sniffing, < 1 MB) with a 512 px limit; where the browser cannot encode WebP the fallback is **PNG, not JPEG**, so transparent logos do not get a black background. Replacing or removing a logo deletes the old file after the row is updated.
- **Text on a brand color is automatic**: `readableForeground(color)` returns black or white, whichever contrasts more. The worst case (a mid grey) is still about 4.6:1, so brand colors can never produce text below WCAG AA (4.5:1); there is nothing for the merchant to get wrong.
- **The storefront wears the brand through CSS variables** set on its root element: `--brand`, `--brand-foreground`, `--brand-accent`, `--brand-accent-foreground`. Storefront components must use these (`var(--brand)`), not hard-coded colors, so the customer login/signup pages can reuse them later.
- **`getPublicStoreBySlug(slug)`** (`src/server/public-store.ts`) is the one place that reads tenant data without a tenant filter, because the visitor is anonymous and the slug is the key. It returns public fields only (never `tenant_id`) and only active stores. Every other read uses `requireMerchant()`'s `tenantId`.

### Pre-launch checklist (before opening signup to the public)
- **Captcha on signup** (Cloudflare Turnstile): the honeypot and timing checks only stop naive bots.
- **Rate limits need the real client IP**: set `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]` for Better Auth (sign-in limit) and make the VPS accept web traffic only from Cloudflare's ranges, otherwise `cf-connecting-ip` can be forged (`clientIp()` in `src/server/request.ts` is used by our own signup limiter). If the app ever runs as several instances, move `rate-limit.ts` to a shared store.
- **Email**: with no provider, emails are unverified and recovery is manual; decide before a larger launch.
- **Strong secrets**: `BETTER_AUTH_SECRET`, `S3_SECRET_KEY`, database password (the local defaults are for development only).
- **Deleting a company must delete its `tenants/<id>/` files** in storage (there is no delete-company feature yet).
- Add `ROOT_DOMAIN`, `S3_*` and `SIGNUP_*` to the production environment; run the `migrator` before each deploy.

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

✅ Done when: `prueba.qvashop.com` shows the catalog of the (approved) store with slug `prueba`.

### Phase 1 — Superadmin panel
- [x] Create companies, stores and users (temporary password)
- [x] Reset passwords
- [x] Impersonate a merchant (logged)

✅ Done when: I can create a complete merchant in 2 minutes.

### Phase 2 — Merchant panel
- [x] Storage (SeaweedFS S3), products schema, merchant panel shell with tenant-scoped product list
- [x] Roles and permissions (access control, `can()`); company roles owner / manager / staff
- [x] Products CRUD (create, edit, delete, status draft/active/archived)
- [x] Product images (upload, delete, main image; compressed to < 1 MB in the browser)
- [x] Store branding: logo, colors
- [x] Merchant self-signup (store pending until the superadmin approves)

✅ Done when: a merchant loads 10 products on their own.

### Phase 3 — Public storefront
- [x] Catalog and product page (public, branded)
- [x] Cart (browser cart, server-priced)
- [x] Catalog v2, part 1: currencies per store, categories with storefront index, hidden default variant, multi-currency prices with compare-at and volume tiers, SEO fields, store profile
- [ ] Catalog v2, part 2: variants editor (options like size/color) + storefront variant picker
- [ ] Catalog v2, part 3: promotions UI (dated sale / override price lists)
- [ ] Checkout that creates an order (pickup only for now)
- [ ] Customer accounts: branded login/signup on the store subdomain (global account + per-store `customer` record)

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
- Order tracking page for customers
- QR code generator for the store link in the merchant panel (the store URL already works as a QR target)
- Companies defining their own roles (Better Auth dynamic access control) and a team management UI
- Email verification and self-service password recovery (needs an email provider)
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
