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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("store_tenantId_idx").on(table.tenantId),
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
