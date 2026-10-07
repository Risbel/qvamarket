import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.ts";

// A company (tenant) is a Better Auth `organization`. `tenant_id` = organization.id.
// Every tenant-owned table carries `tenant_id`, and every query must filter by it.

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
    // ISO 4217 code. All prices of the store's products are in this currency.
    currency: text("currency").default("USD").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
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
    check("store_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;

// Catalog item of a store. Money: integer minor units (cents); the currency is the store's.
// (store_id, tenant_id) is a composite FK to store(id, tenant_id), so a product can never
// point at a store of another tenant.
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
    priceMinor: integer("price_minor").notNull(),
    // null = stock not tracked (always available)
    stock: integer("stock"),
    // draft: hidden, active: visible in the storefront, archived: hidden, kept for old orders
    status: text("status").default("draft").notNull(),
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
    // Target of product_image's composite foreign key
    unique("product_id_tenant_id_unique").on(table.id, table.tenantId),
    index("product_tenantId_idx").on(table.tenantId),
    index("product_storeId_status_idx").on(table.storeId, table.status),
    check("product_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("product_price_non_negative", sql`${table.priceMinor} >= 0`),
    check(
      "product_stock_non_negative",
      sql`${table.stock} is null or ${table.stock} >= 0`,
    ),
    check(
      "product_status",
      sql`${table.status} in ('draft', 'active', 'archived')`,
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
