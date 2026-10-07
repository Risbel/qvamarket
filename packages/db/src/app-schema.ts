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
import { organization } from "./auth-schema.ts";

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
