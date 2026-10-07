import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
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
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("store_tenantId_idx").on(table.tenantId),
    check(
      "store_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`,
    ),
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
