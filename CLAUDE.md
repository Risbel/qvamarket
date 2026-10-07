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
| Database | PostgreSQL + Drizzle ORM |
| Auth | Better Auth (email + password, organizations, admin/impersonation plugins) |
| File storage | S3-compatible (MinIO on the VPS) |
| Hosting | Single VPS (Hetzner) + Dokploy, everything in Docker |
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
- Local development: use `*.localhost` (e.g. `http://mitienda.localhost:3000`), which resolves to 127.0.0.1 in modern browsers without editing the hosts file.

## Architecture decisions

### Multi-tenancy
- **One shared PostgreSQL database** for the MVP. Every tenant-owned table has a `tenant_id` column.
- Data model: **Company (tenant) → Stores → Products / Orders**. The company is the unit of isolation and billing; the store is the unit of catalog and branding.
- All IDs are **UUIDs (v7 preferred)**, never auto-increment, so a tenant's data can later be copied to another database without collisions.
- Every query must be scoped by tenant. Never write a query on tenant data without a `tenant_id` filter.
- Future (not MVP): Postgres Row Level Security, and a tenant registry with a per-tenant connection string so large tenants can be moved to a dedicated database.

### Auth and accounts
- Passwords are **hashed** by Better Auth. Never store plaintext or reversibly encrypted passwords.
- The superadmin creates merchant accounts with a temporary password and a `mustChangePassword` flag; the merchant must change it on first login.
- Password recovery in the MVP: the superadmin resets it manually. No email provider.
- Superadmin can impersonate a merchant; every impersonation is logged.

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

### i18n
- Never hardcode UI text. All strings go in `apps/web/messages/es.json` and `en.json`, with the same keys in both.
- Use `Link`, `redirect`, `useRouter` from `@/i18n/navigation`, not from `next/link` / `next/navigation`.

## Roadmap

Rule: **don't start a phase until the previous one is done.** New ideas go to the Parking Lot, not into the code.

### Phase 0 — Base
- [x] Repo created on GitHub, cloned locally, pnpm monorepo
- [x] Next.js app in `apps/web`
- [x] shadcn/ui
- [x] next-intl (es, en)
- [x] PostgreSQL in Docker (`docker-compose.yml`) + Drizzle in `packages/db`
- [ ] Better Auth with login
- [ ] Subdomain routing in `proxy.ts`
- [ ] Deploy to VPS with Dokploy + wildcard `*.qvashop.com`

✅ Done when: `prueba.qvashop.com` shows "Hola, tienda prueba".

### Phase 1 — Superadmin panel
- [ ] Create companies, stores and users (temporary password)
- [ ] Reset passwords
- [ ] Impersonate a merchant (logged)

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
pnpm --filter @qvashop/db check     # test DB connection
pnpm --filter @qvashop/db generate  # generate migration from schema
pnpm --filter @qvashop/db migrate   # apply migrations
pnpm dlx shadcn@latest add <component>   # run inside apps/web
```
