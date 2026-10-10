import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.ts";

// A company (tenant) is a Better Auth `organization`. `tenant_id` = organization.id.
// Every tenant-owned table carries `tenant_id`, and every query must filter by it.
// Child rows carry a composite FK to their parent's (id, tenant_id) so a row can never point
// at another tenant's parent.

const SLUG_CHECK = "'^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'";

// ---------------------------------------------------------------------------------------
// Currencies (platform catalog, not tenant data)
// ---------------------------------------------------------------------------------------

/**
 * ISO 4217 currencies the platform knows (seeded from the runtime's list). `digits` is the
 * number of minor units (2 for USD, 0 for JPY, 3 for KWD) used to read and write prices.
 * `is_active` lets the superadmin hide a currency from stores without deleting it.
 */
export const currency = pgTable(
  "currency",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    digits: integer("digits").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    check("currency_code_format", sql`${table.code} ~ '^[A-Z]{3}$'`),
    check("currency_digits", sql`${table.digits} between 0 and 4`),
  ],
);

// ---------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------

export const STORE_STATUSES = ["pending", "active", "suspended"] as const;

export const store = pgTable(
  "store",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Subdomain: <slug>.qvashop.com. Unique across all tenants.
    // Reserved slugs (www, app, admin, ...) are enforced in the app (src/lib/tenancy.ts).
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    // pending: just registered, not public until the superadmin approves it
    // active: public storefront; suspended: hidden again by the superadmin.
    // Default pending so a store inserted without thinking is never public by accident.
    status: text("status").default("pending").notNull(),
    // Branding (null = platform default). Colors are lowercase #rrggbb; the logo is a key in
    // object storage (tenants/<tenant_id>/stores/<store_id>/logo/...), URL via publicUrl().
    logoKey: text("logo_key"),
    primaryColor: text("primary_color"),
    accentColor: text("accent_color"),
    // Public profile: shown on the storefront and the order confirmation (pickup)
    description: text("description"),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    contactEmail: text("contact_email"),
    address: text("address"),
    pickupInstructions: text("pickup_instructions"),
    // e.g. { "mon": [["09:00","18:00"]], "sun": [] } (shape validated in the app)
    openingHours: jsonb("opening_hours"),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    // Counter behind order.number: checkout increments it with UPDATE ... RETURNING inside the
    // order's transaction (the row lock serializes checkouts; a rollback leaves no gap).
    lastOrderNumber: integer("last_order_number").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("store_tenantId_idx").on(table.tenantId),
    check("store_last_order_number", sql`${table.lastOrderNumber} >= 0`),
    // Target of the composite foreign keys that tie child rows to the same tenant
    unique("store_id_tenant_id_unique").on(table.id, table.tenantId),
    check(
      "store_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`,
    ),
    check("store_status", sql`${table.status} in ('pending', 'active', 'suspended')`),
    check(
      "store_primary_color_format",
      sql`${table.primaryColor} is null or ${table.primaryColor} ~ '^#[0-9a-f]{6}$'`,
    ),
    check(
      "store_accent_color_format",
      sql`${table.accentColor} is null or ${table.accentColor} ~ '^#[0-9a-f]{6}$'`,
    ),
  ],
);

/**
 * Currencies a store sells in, chosen by its owner/manager. Exactly one is the default (the
 * storefront's starting currency). A variant is sold in a currency only if it has a price in
 * it (variant_price references this table, so a price can only exist in an enabled currency).
 */
export const storeCurrency = pgTable(
  "store_currency",
  {
    storeId: uuid("store_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currency.code),
    isDefault: boolean("is_default").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: "store_currency_pk", columns: [table.storeId, table.currencyCode] }),
    foreignKey({
      name: "store_currency_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    uniqueIndex("store_currency_one_default_idx")
      .on(table.storeId)
      .where(sql`${table.isDefault}`),
  ],
);

// ---------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------

/**
 * Store-level product categories (created by the owner/manager). Flat for now; `parent_id`
 * allows subcategories later. `position` orders the storefront's category index.
 */
export const category = pgTable(
  "category",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    // URL / anchor in the storefront: #<slug>. Unique per store.
    slug: text("slug").notNull(),
    position: integer("position").default(0).notNull(),
    isVisible: boolean("is_visible").default(true).notNull(),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "category_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    // ON DELETE SET NULL ("parent_id") only: the migration SQL is hand-edited, because a plain
    // SET NULL would also try to null tenant_id.
    foreignKey({
      name: "category_parent_tenant_fk",
      columns: [table.parentId, table.tenantId],
      foreignColumns: [table.id, table.tenantId],
    }).onDelete("set null"),
    unique("category_id_tenant_id_unique").on(table.id, table.tenantId),
    unique("category_store_slug_unique").on(table.storeId, table.slug),
    index("category_storeId_position_idx").on(table.storeId, table.position),
    check("category_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("category_slug_format", sql.raw(`slug ~ ${SLUG_CHECK}`)),
    check("category_not_own_parent", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
  ],
);

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;

/**
 * Catalog item of a store: what the customer sees (name, description, images, category, SEO).
 * What is SOLD is a variant (product_variant): every product has at least one. A "simple"
 * product has exactly one, the default variant with no options, which the merchant never
 * sees as a variant. Price and stock live on the variant.
 */
export const product = pgTable(
  "product",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // draft: hidden, active: visible in the storefront, archived: hidden, kept for old orders
    status: text("status").default("draft").notNull(),
    // URL: <store>/products/<slug>. Unique per store.
    slug: text("slug").notNull(),
    categoryId: uuid("category_id"),
    // Search keywords (lowercase), plus SEO overrides for the product page
    tags: text("tags").array().default(sql`'{}'::text[]`).notNull(),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "product_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    // ON DELETE SET NULL ("category_id") only: hand-edited in the migration SQL (see category)
    foreignKey({
      name: "product_category_tenant_fk",
      columns: [table.categoryId, table.tenantId],
      foreignColumns: [category.id, category.tenantId],
    }).onDelete("set null"),
    // Targets of the composite foreign keys of images, options and variants
    unique("product_id_tenant_id_unique").on(table.id, table.tenantId),
    unique("product_id_store_id_tenant_id_unique").on(table.id, table.storeId, table.tenantId),
    unique("product_store_slug_unique").on(table.storeId, table.slug),
    index("product_tenantId_idx").on(table.tenantId),
    index("product_storeId_status_idx").on(table.storeId, table.status),
    index("product_categoryId_idx").on(table.categoryId),
    index("product_tags_idx").using("gin", table.tags),
    check("product_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check(
      "product_status",
      sql`${table.status} in ('draft', 'active', 'archived')`,
    ),
    check("product_slug_format", sql.raw(`slug ~ ${SLUG_CHECK}`)),
  ],
);

/** An option of a product, e.g. "Talla" or "Color" (the app allows at most 3 per product). */
export const productOption = pgTable(
  "product_option",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").default(0).notNull(),
  },
  (table) => [
    foreignKey({
      name: "product_option_product_tenant_fk",
      columns: [table.productId, table.tenantId],
      foreignColumns: [product.id, product.tenantId],
    }).onDelete("cascade"),
    unique("product_option_id_tenant_id_unique").on(table.id, table.tenantId),
    unique("product_option_product_name_unique").on(table.productId, table.name),
    check("product_option_name_not_empty", sql`length(trim(${table.name})) > 0`),
  ],
);

/** A value of an option, e.g. "M" for "Talla". */
export const productOptionValue = pgTable(
  "product_option_value",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    optionId: uuid("option_id").notNull(),
    value: text("value").notNull(),
    position: integer("position").default(0).notNull(),
  },
  (table) => [
    foreignKey({
      name: "product_option_value_option_tenant_fk",
      columns: [table.optionId, table.tenantId],
      foreignColumns: [productOption.id, productOption.tenantId],
    }).onDelete("cascade"),
    unique("product_option_value_id_tenant_id_unique").on(table.id, table.tenantId),
    unique("product_option_value_option_value_unique").on(table.optionId, table.value),
    check("product_option_value_not_empty", sql`length(trim(${table.value})) > 0`),
  ],
);

/**
 * The sellable unit: its own SKU, stock and prices. `option_key` is the sorted list of its
 * option value ids ("" for the default variant of a simple product) and is unique per
 * product, so two variants can never have the same combination.
 */
export const productVariant = pgTable(
  "product_variant",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    sku: text("sku"),
    // display label, e.g. "M / Rojo" (derived from the options; null for the default variant)
    title: text("title"),
    position: integer("position").default(0).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    // null = stock not tracked (always available)
    stock: integer("stock"),
    weightGrams: integer("weight_grams"),
    optionKey: text("option_key").default("").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Same product AND same store AND same tenant
    foreignKey({
      name: "product_variant_product_store_tenant_fk",
      columns: [table.productId, table.storeId, table.tenantId],
      foreignColumns: [product.id, product.storeId, product.tenantId],
    }).onDelete("cascade"),
    unique("product_variant_id_tenant_id_unique").on(table.id, table.tenantId),
    unique("product_variant_id_store_id_tenant_id_unique").on(table.id, table.storeId, table.tenantId),
    unique("product_variant_product_option_key_unique").on(table.productId, table.optionKey),
    uniqueIndex("product_variant_one_default_idx")
      .on(table.productId)
      .where(sql`${table.isDefault}`),
    uniqueIndex("product_variant_tenant_sku_idx")
      .on(table.tenantId, table.sku)
      .where(sql`${table.sku} is not null`),
    index("product_variant_productId_idx").on(table.productId),
    check("product_variant_stock_non_negative", sql`${table.stock} is null or ${table.stock} >= 0`),
    check("product_variant_weight_positive", sql`${table.weightGrams} is null or ${table.weightGrams} > 0`),
    check("product_variant_sku_not_empty", sql`${table.sku} is null or length(trim(${table.sku})) > 0`),
  ],
);

/** Which option values make up a variant (one value per option of the product). */
export const variantOptionValue = pgTable(
  "variant_option_value",
  {
    tenantId: uuid("tenant_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    optionValueId: uuid("option_value_id").notNull(),
  },
  (table) => [
    primaryKey({ name: "variant_option_value_pk", columns: [table.variantId, table.optionValueId] }),
    foreignKey({
      name: "variant_option_value_variant_tenant_fk",
      columns: [table.variantId, table.tenantId],
      foreignColumns: [productVariant.id, productVariant.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "variant_option_value_value_tenant_fk",
      columns: [table.optionValueId, table.tenantId],
      foreignColumns: [productOptionValue.id, productOptionValue.tenantId],
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------

export const PRICE_LIST_KINDS = ["sale", "override"] as const;

/**
 * A set of prices that replaces the regular ones while active, e.g. a dated sale
 * ("Black Friday" from ... to ...). `sale` shows the regular price struck through; `override`
 * just replaces it.
 */
export const priceList = pgTable(
  "price_list",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").default("sale").notNull(),
    // draft: being prepared, active: applies inside its dates
    status: text("status").default("draft").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "price_list_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    unique("price_list_id_tenant_id_unique").on(table.id, table.tenantId),
    index("price_list_storeId_idx").on(table.storeId),
    check("price_list_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("price_list_kind", sql`${table.kind} in ('sale', 'override')`),
    check("price_list_status", sql`${table.status} in ('draft', 'active')`),
    check(
      "price_list_dates",
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

/**
 * A price of a variant in one currency, from `min_quantity` units (1 = the regular price;
 * higher = volume tier, "from 10 units: ..."). Rows with `price_list_id` belong to a price
 * list (promotion) and only apply while it is active. `compare_at_minor` is an optional
 * "was" price shown struck through. Money: integer minor units of the currency, as bigint.
 */
export const variantPrice = pgTable(
  "variant_price",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    currencyCode: text("currency_code").notNull(),
    minQuantity: integer("min_quantity").default(1).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    compareAtMinor: bigint("compare_at_minor", { mode: "number" }),
    priceListId: uuid("price_list_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // The variant belongs to this store and tenant
    foreignKey({
      name: "variant_price_variant_store_tenant_fk",
      columns: [table.variantId, table.storeId, table.tenantId],
      foreignColumns: [productVariant.id, productVariant.storeId, productVariant.tenantId],
    }).onDelete("cascade"),
    // Only in a currency the store has enabled (removing it requires removing its prices).
    // DEFERRABLE INITIALLY DEFERRED in the DB (migration 0010, not expressible here) so that
    // deleting a store, which cascades to both tables, does not trip it.
    foreignKey({
      name: "variant_price_store_currency_fk",
      columns: [table.storeId, table.currencyCode],
      foreignColumns: [storeCurrency.storeId, storeCurrency.currencyCode],
    }),
    foreignKey({
      name: "variant_price_price_list_tenant_fk",
      columns: [table.priceListId, table.tenantId],
      foreignColumns: [priceList.id, priceList.tenantId],
    }).onDelete("cascade"),
    // One price per variant / currency / tier / list (NULL list = the regular prices)
    unique("variant_price_unique")
      .on(table.variantId, table.currencyCode, table.minQuantity, table.priceListId)
      .nullsNotDistinct(),
    index("variant_price_variant_currency_idx").on(table.variantId, table.currencyCode),
    check("variant_price_min_quantity", sql`${table.minQuantity} >= 1`),
    check("variant_price_amount", sql`${table.amountMinor} >= 0`),
    check(
      "variant_price_compare_at",
      sql`${table.compareAtMinor} is null or ${table.compareAtMinor} > ${table.amountMinor}`,
    ),
  ],
);

// Image of a product. The file lives in object storage under tenants/<tenant_id>/...;
// `storageKey` is that key (the URL is derived with publicUrl()).
// Deleting a row does NOT delete the file: the app must call deleteObject() too.
export const productImage = pgTable(
  "product_image",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // 0 is the main image
    position: integer("position").default(0).notNull(),
    altText: text("alt_text"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "product_image_product_tenant_fk",
      columns: [table.productId, table.tenantId],
      foreignColumns: [product.id, product.tenantId],
    }).onDelete("cascade"),
    index("product_image_tenantId_idx").on(table.tenantId),
    index("product_image_productId_position_idx").on(
      table.productId,
      table.position,
    ),
    check("product_image_size_positive", sql`${table.sizeBytes} > 0`),
    check("product_image_position", sql`${table.position} >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------
// Customers and orders
// ---------------------------------------------------------------------------------------

/**
 * A customer of a company (shared by its stores). Guest checkout finds it again by phone
 * (normalized by the app: digits with an optional leading +); `user_id` links it to a global
 * account once customer accounts exist. Orders keep their own copy of name/phone/email, so
 * what a guest types at checkout never rewrites the history of another order.
 */
export const customer = pgTable(
  "customer",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("customer_id_tenant_id_unique").on(table.id, table.tenantId),
    uniqueIndex("customer_tenant_phone_idx")
      .on(table.tenantId, table.phone)
      .where(sql`${table.phone} is not null`),
    uniqueIndex("customer_tenant_user_idx")
      .on(table.tenantId, table.userId)
      .where(sql`${table.userId} is not null`),
    check("customer_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("customer_phone_format", sql`${table.phone} is null or ${table.phone} ~ '^\\+?[0-9]{6,20}$'`),
  ],
);

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;
export const PAYMENT_STATUSES = ["unpaid", "partial", "paid", "refunded"] as const;
export const FULFILLMENT_TYPES = ["pickup", "delivery"] as const;

/**
 * An order placed at checkout. Amounts are computed on the server (never sent by the
 * browser) in integer minor units of `currency_code`, as bigint. `number` is the human
 * reference, unique per store (taken from store.last_order_number). `payment_status` is a
 * cache of the order_payment rows, recomputed by the app in the same transaction that adds
 * or removes a payment; it is never edited directly.
 */
export const order = pgTable(
  "order",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    number: integer("number").notNull(),
    customerId: uuid("customer_id"),
    // Snapshot of the contact the customer gave at checkout
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),
    customerNote: text("customer_note"),
    status: text("status").default("pending").notNull(),
    paymentStatus: text("payment_status").default("unpaid").notNull(),
    fulfillmentType: text("fulfillment_type").default("pickup").notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currency.code),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    deliveryFeeMinor: bigint("delivery_fee_minor", { mode: "number" }).default(0).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    // Sent by the browser once per checkout attempt, so a retried submit cannot create a
    // second order
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "order_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    // ON DELETE SET NULL ("customer_id") only: hand-edited in the migration SQL (see category)
    foreignKey({
      name: "order_customer_tenant_fk",
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customer.id, customer.tenantId],
    }).onDelete("set null"),
    // Targets of the composite foreign keys of items, history and payments
    unique("order_id_tenant_id_unique").on(table.id, table.tenantId),
    unique("order_id_store_id_tenant_id_unique").on(table.id, table.storeId, table.tenantId),
    unique("order_store_number_unique").on(table.storeId, table.number),
    unique("order_store_idempotency_key_unique").on(table.storeId, table.idempotencyKey),
    index("order_storeId_createdAt_idx").on(table.storeId, table.createdAt),
    index("order_storeId_status_idx").on(table.storeId, table.status),
    index("order_customerId_idx").on(table.customerId),
    check("order_number_positive", sql`${table.number} > 0`),
    check(
      "order_status",
      sql.raw(`status in (${ORDER_STATUSES.map((s) => `'${s}'`).join(", ")})`),
    ),
    check(
      "order_payment_status",
      sql.raw(`payment_status in (${PAYMENT_STATUSES.map((s) => `'${s}'`).join(", ")})`),
    ),
    check("order_fulfillment_type", sql`${table.fulfillmentType} in ('pickup', 'delivery')`),
    check(
      "order_out_for_delivery_only_delivery",
      sql`${table.status} <> 'out_for_delivery' or ${table.fulfillmentType} = 'delivery'`,
    ),
    check("order_customer_name_not_empty", sql`length(trim(${table.customerName})) > 0`),
    check("order_customer_phone_not_empty", sql`length(trim(${table.customerPhone})) > 0`),
    check(
      "order_amounts",
      sql`${table.subtotalMinor} >= 0 and ${table.deliveryFeeMinor} >= 0 and ${table.totalMinor} = ${table.subtotalMinor} + ${table.deliveryFeeMinor}`,
    ),
  ],
);

/**
 * A line of an order: a copy of what was bought, at the price it was bought (after volume
 * tiers and promotions). Never re-read the live product or price for an existing order.
 * `variant_id` / `product_id` only link back to the catalog and become NULL if the variant
 * or product is deleted; the snapshot stays.
 */
export const orderItem = pgTable(
  "order_item",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    orderId: uuid("order_id").notNull(),
    variantId: uuid("variant_id"),
    productId: uuid("product_id"),
    position: integer("position").default(0).notNull(),
    productName: text("product_name").notNull(),
    // e.g. "M / Rojo"; null for a product without options
    variantTitle: text("variant_title"),
    sku: text("sku"),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    // The struck-through "was" price shown at checkout, if any
    compareAtMinor: bigint("compare_at_minor", { mode: "number" }),
    lineTotalMinor: bigint("line_total_minor", { mode: "number" }).notNull(),
    // true when checkout took `quantity` from the variant's stock (stock was tracked then);
    // cancelling the order gives it back only in that case
    stockDeducted: boolean("stock_deducted").default(false).notNull(),
  },
  (table) => [
    foreignKey({
      name: "order_item_order_store_tenant_fk",
      columns: [table.orderId, table.storeId, table.tenantId],
      foreignColumns: [order.id, order.storeId, order.tenantId],
    }).onDelete("cascade"),
    // ON DELETE SET NULL ("variant_id") / ("product_id") only: hand-edited in the migration SQL
    foreignKey({
      name: "order_item_variant_store_tenant_fk",
      columns: [table.variantId, table.storeId, table.tenantId],
      foreignColumns: [productVariant.id, productVariant.storeId, productVariant.tenantId],
    }).onDelete("set null"),
    foreignKey({
      name: "order_item_product_store_tenant_fk",
      columns: [table.productId, table.storeId, table.tenantId],
      foreignColumns: [product.id, product.storeId, product.tenantId],
    }).onDelete("set null"),
    index("order_item_orderId_idx").on(table.orderId, table.position),
    index("order_item_variantId_idx").on(table.variantId),
    index("order_item_productId_idx").on(table.productId),
    check("order_item_product_name_not_empty", sql`length(trim(${table.productName})) > 0`),
    check("order_item_quantity", sql`${table.quantity} > 0`),
    check("order_item_unit_price", sql`${table.unitPriceMinor} >= 0`),
    check(
      "order_item_compare_at",
      sql`${table.compareAtMinor} is null or ${table.compareAtMinor} > ${table.unitPriceMinor}`,
    ),
    check(
      "order_item_line_total",
      sql`${table.lineTotalMinor} = ${table.unitPriceMinor} * ${table.quantity}`,
    ),
  ],
);

export const ORDER_ACTORS = ["customer", "merchant", "system"] as const;

/**
 * Audit trail of an order's status: one row per change, written in the same transaction as
 * the change (the first row, from_status NULL, is the order being placed).
 */
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actor: text("actor").notNull(),
    // The merchant team member who made the change (null for customer/system, or once the
    // account is deleted)
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "order_status_history_order_tenant_fk",
      columns: [table.orderId, table.tenantId],
      foreignColumns: [order.id, order.tenantId],
    }).onDelete("cascade"),
    index("order_status_history_orderId_idx").on(table.orderId, table.createdAt),
    check(
      "order_status_history_to_status",
      sql.raw(`to_status in (${ORDER_STATUSES.map((s) => `'${s}'`).join(", ")})`),
    ),
    check(
      "order_status_history_from_status",
      sql.raw(`from_status is null or from_status in (${ORDER_STATUSES.map((s) => `'${s}'`).join(", ")})`),
    ),
    check("order_status_history_actor", sql`${table.actor} in ('customer', 'merchant', 'system')`),
  ],
);

export const PAYMENT_KINDS = ["payment", "refund"] as const;
export const PAYMENT_METHODS = ["cash", "transfer", "other"] as const;

/**
 * Money received (or given back) outside the platform, recorded by hand by the merchant.
 * Always in the order's currency, as a positive amount; `kind` says which direction.
 */
export const orderPayment = pgTable(
  "order_payment",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    kind: text("kind").default("payment").notNull(),
    method: text("method").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
    recordedByUserId: uuid("recorded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "order_payment_order_tenant_fk",
      columns: [table.orderId, table.tenantId],
      foreignColumns: [order.id, order.tenantId],
    }).onDelete("cascade"),
    index("order_payment_orderId_idx").on(table.orderId),
    check("order_payment_kind", sql`${table.kind} in ('payment', 'refund')`),
    check("order_payment_method", sql`${table.method} in ('cash', 'transfer', 'other')`),
    check("order_payment_amount", sql`${table.amountMinor} > 0`),
  ],
);

// Platform-level audit trail (not tenant data): every superadmin impersonation.
// Emails are snapshotted and the user/tenant FKs are SET NULL so the trail
// survives deleting an account.
export const impersonationLog = pgTable(
  "impersonation_log",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    action: text("action").notNull(), // "start" | "stop"
    adminUserId: uuid("admin_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    adminEmail: text("admin_email").notNull(),
    targetUserId: uuid("target_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    targetEmail: text("target_email").notNull(),
    tenantId: uuid("tenant_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("impersonation_log_adminUserId_idx").on(table.adminUserId),
    index("impersonation_log_targetUserId_idx").on(table.targetUserId),
    index("impersonation_log_createdAt_idx").on(table.createdAt),
    check("impersonation_log_action", sql`${table.action} in ('start', 'stop')`),
  ],
);
