import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { invitation, member, organization, user } from "./auth-schema.ts";

// A company (tenant) is a Better Auth `organization`. `tenant_id` = organization.id.
// Every tenant-owned table carries `tenant_id`, and every query must filter by it.
// Child rows carry a composite FK to their parent's (id, tenant_id) so a row can never point
// at another tenant's parent.
//
// Every timestamp is `timestamptz` (withTimezone: true): an absolute instant, independent of
// the database server's timezone. Each viewer's browser shows it in their own timezone.

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
// Company roles
// ---------------------------------------------------------------------------------------

/**
 * A role a company defines for its team: a set of resource + action permissions
 * (`{ "product": ["read", "update"], ... }`, validated by the app on write and on read).
 * `member.role` (Better Auth) holds the role's `key`, which never changes on rename: a
 * preset's key (`manager`, `cashier`...) or `r-<random>` for a custom role. `owner` is
 * built into the app (every permission) and never stored here. `preset_key` = the preset
 * the row was seeded from (null = created from scratch).
 */
export const companyRole = pgTable(
  "company_role",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissions: jsonb("permissions").default({}).notNull(),
    presetKey: text("preset_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("company_role_tenant_key_unique").on(table.tenantId, table.key),
    uniqueIndex("company_role_tenant_name_unique").on(table.tenantId, sql`lower(${table.name})`),
    check("company_role_key_format", sql`${table.key} ~ '^[a-z][a-z0-9-]{0,39}$' and ${table.key} <> 'owner'`),
    check("company_role_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("company_role_permissions_object", sql`jsonb_typeof(${table.permissions}) = 'object'`),
  ],
);

// ---------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------
// Store access of team members (which of the company's stores a member can open)
// ---------------------------------------------------------------------------------------

export const MEMBER_STORE_SCOPES = ["all", "stores"] as const;

/**
 * A member's store access: `all` = every store of the company (also future ones), `stores`
 * = only the stores listed in `member_store` (none left = no store at all). A member without
 * a row has access to every store (members from before this table). Owners always see every
 * store, whatever is stored here. Deleted with the membership.
 */
export const memberAccess = pgTable(
  "member_access",
  {
    memberId: uuid("member_id")
      .primaryKey()
      .references(() => member.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [check("member_access_scope", sql`${table.scope} in ('all', 'stores')`)],
);

/** The stores of a member whose access is `stores`. Removed with the store or the membership. */
export const memberStore = pgTable(
  "member_store",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
  },
  (table) => [
    primaryKey({ name: "member_store_pk", columns: [table.memberId, table.storeId] }),
    foreignKey({
      name: "member_store_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    index("member_store_storeId_idx").on(table.storeId),
  ],
);

/**
 * The store access an invitation will give: `store_ids` null = every store, otherwise only
 * those (an array: the invitation is short-lived and the ids are checked against the
 * company's stores again when it is accepted). Deleted with the invitation.
 */
export const invitationAccess = pgTable("invitation_access", {
  invitationId: uuid("invitation_id")
    .primaryKey()
    .references(() => invitation.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  storeIds: uuid("store_ids").array(),
});

// ---------------------------------------------------------------------------------------

export const STORE_STATUSES = ["pending", "active", "suspended"] as const;
// Storefront theme choices (Settings > Branding): corner radius in rem and the shadcn base
// gray. The full token set is generated by the app from these (src/lib/store-theme.ts).
export const THEME_RADII = ["0", "0.3", "0.5", "0.625", "0.75", "1"] as const;
export const THEME_BASES = ["neutral", "stone", "zinc", "gray", "slate"] as const;

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
    // Logotype: the logo with the store's name in it (icon + letters, usually wide). When set,
    // the storefront header shows it INSTEAD of the logo + name (stores/<store_id>/logotype/...).
    logotypeKey: text("logotype_key"),
    primaryColor: text("primary_color"),
    accentColor: text("accent_color"),
    // Generated storefront theme inputs (null = platform default: 0.625 rem, neutral gray).
    // tinted = secondary / accent / muted surfaces take the primary color's hue.
    themeRadius: text("theme_radius"),
    themeBase: text("theme_base"),
    themeTinted: boolean("theme_tinted").default(false).notNull(),
    // Secondary banner (pairs of tiles under the hero) on/off: hides it without deleting images
    secondaryBannerVisible: boolean("secondary_banner_visible").default(true).notNull(),
    // Public profile: shown on the storefront and the order confirmation (pickup)
    description: text("description"),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    contactEmail: text("contact_email"),
    address: text("address"),
    // ISO 3166-1 alpha-2 (e.g. "CU"): preselected country for phone numbers typed without a
    // "+", whose calling code is then added. null = customers must type the international form.
    // The supported list lives in the app (src/lib/countries.ts).
    phoneCountry: text("phone_country"),
    // IANA timezone of the business (e.g. "America/Havana"): reports and the day close count
    // the store's days in it, whoever looks. Validated in the app (canonicalTimeZone).
    timeZone: text("time_zone").default("America/Havana").notNull(),
    pickupInstructions: text("pickup_instructions"),
    // e.g. { "mon": [["09:00","18:00"]], "sun": [] } (shape validated in the app)
    openingHours: jsonb("opening_hours"),
    // Storefront footer: groups of links, in display order (array order = position), e.g.
    // [{ "title": "Accesos", "links": [{ "label": "Contacto", "url": "/contact", "newTab": false }] }].
    // Always read and written whole, so jsonb instead of tables. Shape and URL safety are
    // validated in the app (src/lib/footer.ts) on write AND on read. null = no footer links.
    footerLinks: jsonb("footer_links"),
    // Short text under the logo + name in the storefront footer (plain text). null = none.
    footerText: text("footer_text"),
    // Social media icons in the storefront footer, in display order, one per network, e.g.
    // [{ "network": "instagram", "url": "https://instagram.com/tienda" }]. Validated in the app
    // (src/lib/social.ts) on write AND on read. null = none.
    footerSocial: jsonb("footer_social"),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    // Counter behind order.number: checkout increments it with UPDATE ... RETURNING inside the
    // order's transaction (the row lock serializes checkouts; a rollback leaves no gap).
    lastOrderNumber: integer("last_order_number").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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
    check("store_phone_country_format", sql`${table.phoneCountry} is null or ${table.phoneCountry} ~ '^[A-Z]{2}$'`),
    check(
      "store_primary_color_format",
      sql`${table.primaryColor} is null or ${table.primaryColor} ~ '^#[0-9a-f]{6}$'`,
    ),
    check(
      "store_accent_color_format",
      sql`${table.accentColor} is null or ${table.accentColor} ~ '^#[0-9a-f]{6}$'`,
    ),
    check(
      "store_theme_radius",
      sql.raw(`theme_radius is null or theme_radius in (${THEME_RADII.map((r) => `'${r}'`).join(", ")})`),
    ),
    check(
      "store_theme_base",
      sql.raw(`theme_base is null or theme_base in (${THEME_BASES.map((b) => `'${b}'`).join(", ")})`),
    ),
    check(
      "store_footer_links_array",
      sql`${table.footerLinks} is null or jsonb_typeof(${table.footerLinks}) = 'array'`,
    ),
    check(
      "store_footer_social_array",
      sql`${table.footerSocial} is null or jsonb_typeof(${table.footerSocial}) = 'array'`,
    ),
  ],
);

export const STORE_PAGE_STATUSES = ["draft", "published"] as const;

/**
 * Custom pages of a store ("Sobre nosotros", "Envíos"...), served at <store>/<locale>/<slug>.
 * `content` is plain text with a few simple marks (headings, lists, bold, links) that the app
 * turns into React elements (src/lib/store-pages.ts); it is never rendered as HTML. Slugs that
 * collide with storefront routes are refused in the app. Max pages per store: app limit.
 */
export const storePage = pgTable(
  "store_page",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    title: text("title").notNull(),
    // URL: <store>/<locale>/<slug>. Unique per store.
    slug: text("slug").notNull(),
    content: text("content").default("").notNull(),
    // draft: only the team sees it (in the panel), published: public
    status: text("status").default("draft").notNull(),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "store_page_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    unique("store_page_store_slug_unique").on(table.storeId, table.slug),
    index("store_page_tenantId_idx").on(table.tenantId),
    check("store_page_title_not_empty", sql`length(trim(${table.title})) > 0`),
    check("store_page_slug_format", sql.raw(`slug ~ ${SLUG_CHECK}`)),
    check("store_page_status", sql`${table.status} in ('draft', 'published')`),
  ],
);

/**
 * Currencies a store sells in, chosen by its owner/manager. Exactly one is the default (the
 * storefront's starting currency) and exactly one is the base (the currency the merchant
 * types prices in). Every other currency may have an exchange rate: a variant without its
 * own (manual) prices in that currency is sold at its base prices x rate, rounded to
 * `rounding_minor` (see src/lib/exchange.ts). No rate = only manual prices are sold there.
 * variant_price references this table, so a price can only exist in an enabled currency.
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
    isBase: boolean("is_base").default(false).notNull(),
    /** units of this currency for 1 unit of the base currency (null = no automatic prices) */
    exchangeRate: numeric("exchange_rate", { precision: 20, scale: 8 }),
    /** automatic prices are rounded to a multiple of this, in minor units (null = 1) */
    roundingMinor: bigint("rounding_minor", { mode: "number" }),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    uniqueIndex("store_currency_one_base_idx")
      .on(table.storeId)
      .where(sql`${table.isBase}`),
    check("store_currency_rate_positive", sql`${table.exchangeRate} is null or ${table.exchangeRate} > 0`),
    check("store_currency_base_no_rate", sql`not (${table.isBase} and ${table.exchangeRate} is not null)`),
    check("store_currency_rounding_positive", sql`${table.roundingMinor} is null or ${table.roundingMinor} > 0`),
  ],
);

/** Max corners of a delivery area (keeps the polygon light to store and to test against). */
export const MAX_SERVICE_AREA_POINTS = 200;

export const DELIVERY_FEE_MODES = ["free", "flat", "distance"] as const;

/**
 * Home delivery settings of a store (1:1, created on first save; without a row the store
 * offers pickup only). `fee_mode`: free, flat (the rate's base fee) or distance (base fee
 * covers `base_distance_m`, then the rate's per-km charge for each started km). The store's location is
 * where orders leave from (distance-based fees are measured from it, in a straight line); the
 * service area is a polygon drawn by the merchant on the map: [lng, lat] corners (GeoJSON
 * order), not closed (the first corner is not repeated). Coordinates are WGS84 degrees.
 */
export const storeDelivery = pgTable(
  "store_delivery",
  {
    storeId: uuid("store_id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    locationLat: doublePrecision("location_lat"),
    locationLng: doublePrecision("location_lng"),
    serviceArea: jsonb("service_area").$type<[number, number][]>(),
    deliveryEnabled: boolean("delivery_enabled").default(false).notNull(),
    pickupEnabled: boolean("pickup_enabled").default(true).notNull(),
    feeMode: text("fee_mode").default("flat").notNull(),
    baseDistanceM: integer("base_distance_m").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "store_delivery_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    check(
      "store_delivery_location",
      sql`(${table.locationLat} is null and ${table.locationLng} is null) or (${table.locationLat} between -90 and 90 and ${table.locationLng} between -180 and 180)`,
    ),
    check(
      "store_delivery_service_area",
      sql.raw(
        `service_area is null or (jsonb_typeof(service_area) = 'array' and jsonb_array_length(service_area) between 3 and ${MAX_SERVICE_AREA_POINTS})`,
      ),
    ),
    check("store_delivery_fee_mode", sql.raw(`fee_mode in (${DELIVERY_FEE_MODES.map((m) => `'${m}'`).join(", ")})`)),
    check("store_delivery_base_distance", sql`${table.baseDistanceM} between 0 and 1000000`),
    // a store always offers at least one way to get the order
    check("store_delivery_some_fulfillment", sql`${table.deliveryEnabled} or ${table.pickupEnabled}`),
    // delivery needs somewhere to leave from and an area to deliver to
    check(
      "store_delivery_enabled_needs_area",
      sql`not ${table.deliveryEnabled} or (${table.locationLat} is not null and ${table.serviceArea} is not null)`,
    ),
  ],
);

// Images of the storefront's hero banner (a carousel at the top of the home page). Each image
// belongs to one screen size: "desktop" images are only shown on wide screens and "mobile"
// images only on phones (their shapes differ and banners carry text, so neither is cropped
// to fit the other). A screen size without images shows no banner. Files live under
// tenants/<tenantId>/stores/<storeId>/banner/.
export const BANNER_DEVICES = ["desktop", "mobile"] as const;

export const storeBannerImage = pgTable(
  "store_banner_image",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    device: text("device").default("desktop").notNull(),
    // 0 is shown first; positions are counted per device
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "store_banner_image_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    index("store_banner_image_tenantId_idx").on(table.tenantId),
    index("store_banner_image_storeId_device_position_idx").on(table.storeId, table.device, table.position),
    check("store_banner_image_device", sql.raw(`device in (${BANNER_DEVICES.map((d) => `'${d}'`).join(", ")})`)),
    check("store_banner_image_size_positive", sql`${table.sizeBytes} > 0`),
    check("store_banner_image_position", sql`${table.position} >= 0`),
  ],
);

// Secondary banner: a carousel under the hero whose slides are PAIRS of tiles shown side by
// side (both change together). One row = one slide; each side is filled separately, and a
// pair missing a side is not shown. Same desktop/mobile split as the hero. Only shown where
// the hero has images, and only while store.secondary_banner_visible. Files live under
// tenants/<tenantId>/stores/<storeId>/banner/secondary/.
export const storeSecondaryBannerPair = pgTable(
  "store_secondary_banner_pair",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    device: text("device").notNull(),
    // 0 is shown first; positions are counted per device
    position: integer("position").default(0).notNull(),
    leftStorageKey: text("left_storage_key").unique(),
    leftContentType: text("left_content_type"),
    leftSizeBytes: integer("left_size_bytes"),
    rightStorageKey: text("right_storage_key").unique(),
    rightContentType: text("right_content_type"),
    rightSizeBytes: integer("right_size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "store_secondary_banner_pair_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    index("store_secondary_banner_pair_tenantId_idx").on(table.tenantId),
    index("store_secondary_banner_pair_storeId_device_position_idx").on(table.storeId, table.device, table.position),
    check(
      "store_secondary_banner_pair_device",
      sql.raw(`device in (${BANNER_DEVICES.map((d) => `'${d}'`).join(", ")})`),
    ),
    check("store_secondary_banner_pair_position", sql`${table.position} >= 0`),
    // each side is all set (key, type, positive size) or all empty
    check(
      "store_secondary_banner_pair_left",
      sql`(${table.leftStorageKey} is null and ${table.leftContentType} is null and ${table.leftSizeBytes} is null) or (${table.leftStorageKey} is not null and ${table.leftContentType} is not null and ${table.leftSizeBytes} > 0)`,
    ),
    check(
      "store_secondary_banner_pair_right",
      sql`(${table.rightStorageKey} is null and ${table.rightContentType} is null and ${table.rightSizeBytes} is null) or (${table.rightStorageKey} is not null and ${table.rightContentType} is not null and ${table.rightSizeBytes} > 0)`,
    ),
  ],
);

/**
 * Delivery amounts of a store in one of its currencies (no conversion, like prices): the
 * base fee (flat mode: the whole fee; distance mode: covers the base distance), the charge
 * per started km beyond it (distance mode), free delivery from an order subtotal (null =
 * never) and the minimum order for delivery (null = none). A currency without a row has no
 * delivery fee set: delivery is not offered in it (except in free mode).
 */
export const storeDeliveryRate = pgTable(
  "store_delivery_rate",
  {
    storeId: uuid("store_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    currencyCode: text("currency_code").notNull(),
    baseFeeMinor: bigint("base_fee_minor", { mode: "number" }).default(0).notNull(),
    perKmMinor: bigint("per_km_minor", { mode: "number" }).default(0).notNull(),
    freeAboveMinor: bigint("free_above_minor", { mode: "number" }),
    minOrderMinor: bigint("min_order_minor", { mode: "number" }),
  },
  (table) => [
    primaryKey({ name: "store_delivery_rate_pk", columns: [table.storeId, table.currencyCode] }),
    foreignKey({
      name: "store_delivery_rate_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    // removing a currency from the store removes its delivery amounts
    foreignKey({
      name: "store_delivery_rate_store_currency_fk",
      columns: [table.storeId, table.currencyCode],
      foreignColumns: [storeCurrency.storeId, storeCurrency.currencyCode],
    }).onDelete("cascade"),
    check(
      "store_delivery_rate_amounts",
      sql`${table.baseFeeMinor} >= 0 and ${table.perKmMinor} >= 0 and (${table.freeAboveMinor} is null or ${table.freeAboveMinor} > 0) and (${table.minOrderMinor} is null or ${table.minOrderMinor} > 0)`,
    ),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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
    // What one unit cost the store (inventory value and profit), in `cost_currency_code`
    // (the base currency when it was typed); null = unknown. Never shown to shoppers.
    costMinor: bigint("cost_minor", { mode: "number" }),
    costCurrencyCode: text("cost_currency_code").references(() => currency.code),
    weightGrams: integer("weight_grams"),
    optionKey: text("option_key").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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
    check(
      "product_variant_cost",
      sql`(${table.costMinor} is null) = (${table.costCurrencyCode} is null) and (${table.costMinor} is null or ${table.costMinor} >= 0)`,
    ),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

// A product image uploaded from the product form but not saved yet (staged upload). The file
// is already in storage; saving the form moves the row to `product_image` (same storage key).
// Rows the merchant never saved are swept after a day (the app deletes their files too).
export const productUpload = pgTable(
  "product_upload",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "product_upload_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    index("product_upload_tenantId_idx").on(table.tenantId),
    index("product_upload_storeId_createdAt_idx").on(table.storeId, table.createdAt),
    check("product_upload_size_positive", sql`${table.sizeBytes} > 0`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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

/**
 * A product a signed-in customer marked with the heart on a storefront. Belongs to the
 * company's customer record; the store comes with the product (composite FK), so the list of
 * one store never shows another's products. Deleting the product or the customer removes it.
 */
export const favorite = pgTable(
  "favorite",
  {
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    productId: uuid("product_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: "favorite_pk", columns: [table.customerId, table.productId] }),
    foreignKey({
      name: "favorite_customer_tenant_fk",
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customer.id, customer.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "favorite_product_store_tenant_fk",
      columns: [table.productId, table.storeId, table.tenantId],
      foreignColumns: [product.id, product.storeId, product.tenantId],
    }).onDelete("cascade"),
    index("favorite_customer_store_idx").on(table.customerId, table.storeId, table.createdAt),
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
    // The customer account that placed the order while signed in on the store (null = guest
    // checkout). The customer's order history lists only these: a phone number typed at
    // guest checkout proves nothing, so guest orders are never shown to an account.
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
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
    index("order_storeId_userId_idx").on(table.storeId, table.userId, table.createdAt),
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
    // What checkout took, kept once the store lowered the line afterwards (the customer
    // changed their mind, or the product was not really there); null = never edited.
    // A removed line stays with quantity 0, so the order still shows what was asked for.
    originalQuantity: integer("original_quantity"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    // The struck-through "was" price shown at checkout, if any
    compareAtMinor: bigint("compare_at_minor", { mode: "number" }),
    lineTotalMinor: bigint("line_total_minor", { mode: "number" }).notNull(),
    // true when checkout took `quantity` from the variant's stock (stock was tracked then);
    // cancelling the order gives it back only in that case
    stockDeducted: boolean("stock_deducted").default(false).notNull(),
    // What one unit cost the store, in the order's currency (the variant's cost converted at
    // checkout); null = unknown. For gross profit, never shown to the customer.
    unitCostMinor: bigint("unit_cost_minor", { mode: "number" }),
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
    // Only an edited line can reach 0, and an edit only ever lowers the quantity
    check(
      "order_item_quantity",
      sql`(${table.quantity} > 0 or (${table.quantity} = 0 and ${table.originalQuantity} is not null)) and (${table.originalQuantity} is null or ${table.quantity} < ${table.originalQuantity})`,
    ),
    check("order_item_unit_price", sql`${table.unitPriceMinor} >= 0`),
    check(
      "order_item_compare_at",
      sql`${table.compareAtMinor} is null or ${table.compareAtMinor} > ${table.unitPriceMinor}`,
    ),
    check("order_item_unit_cost", sql`${table.unitCostMinor} is null or ${table.unitCostMinor} >= 0`),
    check(
      "order_item_line_total",
      sql`${table.lineTotalMinor} = ${table.unitPriceMinor} * ${table.quantity}`,
    ),
  ],
);

/**
 * Where a delivery order goes (1:1 with orders whose fulfillment_type is delivery): a
 * snapshot taken at checkout, never re-read from the store settings. The customer's pin is
 * what the server checked against the service area and measured the distance from (straight
 * line from the store); the address is what they typed (street, number, reference). The fee
 * itself is order.delivery_fee_minor.
 */
export const orderDelivery = pgTable(
  "order_delivery",
  {
    orderId: uuid("order_id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    address: text("address").notNull(),
    locationLat: doublePrecision("location_lat").notNull(),
    locationLng: doublePrecision("location_lng").notNull(),
    distanceM: integer("distance_m").notNull(),
    // the store's fee mode when the order was placed (free / flat / distance)
    feeMode: text("fee_mode").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "order_delivery_order_store_tenant_fk",
      columns: [table.orderId, table.storeId, table.tenantId],
      foreignColumns: [order.id, order.storeId, order.tenantId],
    }).onDelete("cascade"),
    check("order_delivery_address_not_empty", sql`length(trim(${table.address})) > 0`),
    check("order_delivery_location", sql`${table.locationLat} between -90 and 90 and ${table.locationLng} between -180 and 180`),
    check("order_delivery_distance", sql`${table.distanceM} >= 0`),
    check("order_delivery_fee_mode", sql.raw(`fee_mode in (${DELIVERY_FEE_MODES.map((m) => `'${m}'`).join(", ")})`)),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

/** One line changed by an order edit (snapshot: the item may be renamed or removed later). */
export type OrderEditChange = {
  itemId: string;
  productName: string;
  variantTitle: string | null;
  from: number;
  to: number;
  /** units given back to the variant's stock (0 when the staff chose not to, or it is not tracked) */
  restocked: number;
};

/**
 * Audit trail of the items of an order changed by the store after checkout ("edit order"):
 * who, when, why, which lines and how the subtotal moved. Written in the same transaction
 * as the edit.
 */
export const orderEdit = pgTable(
  "order_edit",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    changes: jsonb("changes").$type<OrderEditChange[]>().notNull(),
    subtotalBeforeMinor: bigint("subtotal_before_minor", { mode: "number" }).notNull(),
    subtotalAfterMinor: bigint("subtotal_after_minor", { mode: "number" }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "order_edit_order_tenant_fk",
      columns: [table.orderId, table.tenantId],
      foreignColumns: [order.id, order.tenantId],
    }).onDelete("cascade"),
    index("order_edit_orderId_idx").on(table.orderId, table.createdAt),
    check("order_edit_changes_array", sql`jsonb_typeof(${table.changes}) = 'array'`),
    check(
      "order_edit_subtotals",
      sql`${table.subtotalAfterMinor} >= 0 and ${table.subtotalAfterMinor} <= ${table.subtotalBeforeMinor}`,
    ),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "order_payment_order_tenant_fk",
      columns: [table.orderId, table.tenantId],
      foreignColumns: [order.id, order.tenantId],
    }).onDelete("cascade"),
    index("order_payment_orderId_idx").on(table.orderId),
    // income summaries filter by the payment date
    index("order_payment_tenantId_paidAt_idx").on(table.tenantId, table.paidAt),
    check("order_payment_kind", sql`${table.kind} in ('payment', 'refund')`),
    check("order_payment_method", sql`${table.method} in ('cash', 'transfer', 'other')`),
    check("order_payment_amount", sql`${table.amountMinor} > 0`),
  ],
);

// ---------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------

/**
 * Why a variant's stock changed. `sale`, `cancel` and `order_edit` are written by orders;
 * the rest by the merchant (`initial` = the first count of a new product, `adjustment` = a
 * count correction).
 */
export const INVENTORY_REASONS = [
  "initial",
  "received",
  "sale",
  "cancel",
  "order_edit",
  "adjustment",
  "damaged",
  "gift",
  "return",
  "other",
] as const;

/**
 * Every change of a tracked variant's stock, written in the same transaction as the change.
 * `delta` is signed (units in > 0, out < 0) and `stock_after` is the stock right after it.
 * The cost is the unit cost of a reception (null = unknown or not applicable).
 */
export const inventoryMovement = pgTable(
  "inventory_movement",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    reason: text("reason").notNull(),
    delta: integer("delta").notNull(),
    stockAfter: integer("stock_after").notNull(),
    unitCostMinor: bigint("unit_cost_minor", { mode: "number" }),
    costCurrencyCode: text("cost_currency_code").references(() => currency.code),
    orderId: uuid("order_id"),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "inventory_movement_variant_store_tenant_fk",
      columns: [table.variantId, table.storeId, table.tenantId],
      foreignColumns: [productVariant.id, productVariant.storeId, productVariant.tenantId],
    }).onDelete("cascade"),
    // ON DELETE SET NULL ("order_id") only: hand-edited in the migration SQL (see category)
    foreignKey({
      name: "inventory_movement_order_tenant_fk",
      columns: [table.orderId, table.tenantId],
      foreignColumns: [order.id, order.tenantId],
    }).onDelete("set null"),
    index("inventory_movement_variantId_idx").on(table.variantId, table.createdAt),
    index("inventory_movement_storeId_idx").on(table.storeId, table.createdAt),
    check(
      "inventory_movement_reason",
      sql.raw(`reason in (${INVENTORY_REASONS.map((r) => `'${r}'`).join(", ")})`),
    ),
    check("inventory_movement_delta", sql`${table.delta} <> 0`),
    check("inventory_movement_stock_after", sql`${table.stockAfter} >= 0`),
    check(
      "inventory_movement_cost",
      sql`(${table.unitCostMinor} is null) = (${table.costCurrencyCode} is null) and (${table.unitCostMinor} is null or ${table.unitCostMinor} >= 0)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------------------

/**
 * What a store spends on running the business. Buying goods for resale is NOT an expense
 * here: it is stock received in the inventory, and its cost reaches the profit as the cost
 * of the goods sold (counting it twice would understate the profit).
 */
export const EXPENSE_CATEGORIES = [
  "salaries",
  "rent",
  "utilities",
  "transport",
  "maintenance",
  "marketing",
  "taxes",
  "fees",
  "supplies",
  "other",
] as const;

/**
 * Money a store paid out, recorded by hand. `amount_minor` is positive, in `currency_code`
 * (one of the store's currencies when recorded; the FK is to the platform list so removing a
 * currency from the store never touches old expenses). `member_user_id` = the team member a
 * salary was paid to (SET NULL when the account goes; `payee` keeps the name).
 */
export const expense = pgTable(
  "expense",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    category: text("category").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currency.code),
    method: text("method").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
    payee: text("payee"),
    memberUserId: uuid("member_user_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "expense_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    index("expense_storeId_paidAt_idx").on(table.storeId, table.paidAt),
    check(
      "expense_category",
      sql.raw(`category in (${EXPENSE_CATEGORIES.map((c) => `'${c}'`).join(", ")})`),
    ),
    check("expense_method", sql`${table.method} in ('cash', 'transfer', 'other')`),
    check("expense_amount", sql`${table.amountMinor} > 0`),
    check("expense_payee_not_empty", sql`${table.payee} is null or length(trim(${table.payee})) > 0`),
  ],
);

// ---------------------------------------------------------------------------------------
// Cash register (day close)
// ---------------------------------------------------------------------------------------

export const REGISTER_SESSION_STATUSES = ["open", "closed"] as const;
export const REGISTER_MOVEMENT_KINDS = ["in", "out"] as const;

/**
 * A cash register session of a store: opened with a float, closed with a cash count. It covers
 * the time [opened_at, closed_at): cash payments, refunds and expenses paid in it are what the
 * drawer should hold. At most one open session per store. `number` counts the store's sessions
 * (the Z report number). `report` = the frozen closing report (src/lib/register.ts), written
 * once at close and never recomputed.
 */
export const registerSession = pgTable(
  "register_session",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    number: integer("number").notNull(),
    status: text("status").default("open").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    openedByUserId: uuid("opened_by_user_id").references(() => user.id, { onDelete: "set null" }),
    openingNote: text("opening_note"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: uuid("closed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    closingNote: text("closing_note"),
    report: jsonb("report"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("register_session_id_store_tenant_unique").on(table.id, table.storeId, table.tenantId),
    unique("register_session_store_number_unique").on(table.storeId, table.number),
    foreignKey({
      name: "register_session_store_tenant_fk",
      columns: [table.storeId, table.tenantId],
      foreignColumns: [store.id, store.tenantId],
    }).onDelete("cascade"),
    uniqueIndex("register_session_one_open").on(table.storeId).where(sql`${table.status} = 'open'`),
    index("register_session_store_closedAt_idx").on(table.storeId, table.closedAt),
    check("register_session_status", sql`${table.status} in ('open', 'closed')`),
    check("register_session_number", sql`${table.number} >= 1`),
    check(
      "register_session_closed",
      sql`(${table.status} = 'closed') = (${table.closedAt} is not null) and (${table.closedAt} is null or ${table.closedAt} >= ${table.openedAt})`,
    ),
    check("register_session_report", sql`(${table.status} = 'closed') = (${table.report} is not null)`),
  ],
);

/**
 * Per session and currency: the opening float and, once closed, what was expected and what
 * was counted (difference = counted - expected: over > 0, short < 0). Kept as columns, not
 * only in the report, so history lists and sums need no JSON.
 */
export const registerSessionCurrency = pgTable(
  "register_session_currency",
  {
    sessionId: uuid("session_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currency.code),
    openingMinor: bigint("opening_minor", { mode: "number" }).notNull(),
    expectedMinor: bigint("expected_minor", { mode: "number" }),
    countedMinor: bigint("counted_minor", { mode: "number" }),
  },
  (table) => [
    primaryKey({ name: "register_session_currency_pk", columns: [table.sessionId, table.currencyCode] }),
    foreignKey({
      name: "register_session_currency_session_fk",
      columns: [table.sessionId, table.storeId, table.tenantId],
      foreignColumns: [registerSession.id, registerSession.storeId, registerSession.tenantId],
    }).onDelete("cascade"),
    check("register_session_currency_opening", sql`${table.openingMinor} >= 0`),
    check("register_session_currency_counted", sql`${table.countedMinor} is null or ${table.countedMinor} >= 0`),
    check("register_session_currency_closed", sql`(${table.expectedMinor} is null) = (${table.countedMinor} is null)`),
  ],
);

/**
 * Cash put into (`in`, e.g. more change) or taken out of (`out`, e.g. a bank deposit, the
 * owner's withdrawal) the drawer during a session, with the reason. Never edited or deleted:
 * a mistake is corrected with the opposite movement. Purchases with the drawer's cash are
 * expenses (paid in cash), not movements.
 */
export const registerMovement = pgTable(
  "register_movement",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storeId: uuid("store_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    kind: text("kind").notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currency.code),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    note: text("note").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "register_movement_session_fk",
      columns: [table.sessionId, table.storeId, table.tenantId],
      foreignColumns: [registerSession.id, registerSession.storeId, registerSession.tenantId],
    }).onDelete("cascade"),
    index("register_movement_sessionId_idx").on(table.sessionId, table.createdAt),
    check("register_movement_kind", sql`${table.kind} in ('in', 'out')`),
    check("register_movement_amount", sql`${table.amountMinor} > 0`),
    check("register_movement_note", sql`length(trim(${table.note})) > 0`),
  ],
);

// ---------------------------------------------------------------------------------------
// Plans and billing (platform data: what a company pays QvaShop)
// ---------------------------------------------------------------------------------------
// No payment gateway: the merchant pays outside the platform and the superadmin records it.
// Limits of each plan are defined in the app (src/lib/plans.ts); which features each plan
// includes (plan_setting), prices, subscriptions and their money live here. Invoices,
// payments and events are never deleted (mistakes are voided or refunded) and survive the
// company (tenant_id SET NULL + snapshot).

export const PLAN_KEYS = ["free", "basic", "pro", "business"] as const;
/** Every plan feature the app knows (src/lib/plans.ts); plan_setting.features holds a subset. */
export const PLAN_FEATURES = [
  "customers",
  "promotions",
  "inventory",
  "expenses",
  "advancedReports",
  "theme",
  "secondaryBanner",
  "distanceFees",
  "bulkPrices",
  "customRoles",
  "storeAccess",
  "hideBadge",
  "dayClose",
] as const;
export const BILLING_CYCLES = ["monthly", "quarterly", "yearly"] as const;
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "paused", "cancelled", "expired"] as const;
/** `overdue` is not stored: an open or partial invoice past `due_at` (derived on read). */
export const INVOICE_STATUSES = ["open", "partial", "paid", "void"] as const;
export const INVOICE_KINDS = ["renewal", "upgrade", "manual"] as const;
export const BILLING_PAYMENT_METHODS = ["cash", "transfer", "zelle", "other"] as const;
export const BILLING_ACTORS = ["admin", "owner", "system"] as const;
export const SUBSCRIPTION_EVENT_TYPES = [
  "created",
  "trial_started",
  "trial_ended",
  "plan_upgraded",
  "downgrade_scheduled",
  "downgrade_cancelled",
  "plan_downgraded",
  "cycle_changed",
  "paused",
  "resumed",
  "cancel_scheduled",
  "reactivated",
  "cancelled",
  "renewed",
  "invoice_issued",
  "invoice_voided",
  "payment_recorded",
  "refund_recorded",
  "became_past_due",
  "expired",
  "price_changed",
  // the superadmin changed a plan's features or whether it is offered (plan_setting)
  "plan_updated",
  // the superadmin corrected the paid-until date or the trial end by hand
  "period_adjusted",
  "trial_adjusted",
  // the owner asked for a plan change or a pause (billing_request), and the superadmin closed it
  "change_requested",
  "request_closed",
] as const;

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
const inList = (column: string, values: readonly string[]) => sql.raw(`${column} in (${quoted(values)})`);
const inListOrNull = (column: string, values: readonly string[]) =>
  sql.raw(`${column} is null or ${column} in (${quoted(values)})`);

/**
 * What each plan includes (edited by the superadmin in /admin/prices, applied right away to
 * every company on the plan) and whether merchants can choose it. One row per plan, seeded
 * by the migration.
 */
export const planSetting = pgTable(
  "plan_setting",
  {
    planKey: text("plan_key").primaryKey(),
    features: text("features").array().default(sql`'{}'::text[]`).notNull(),
    isOffered: boolean("is_offered").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  () => [
    check("plan_setting_plan", inList("plan_key", PLAN_KEYS)),
    check("plan_setting_features", sql.raw(`features <@ array[${quoted(PLAN_FEATURES)}]::text[]`)),
  ],
);

/** Price of a paid plan per billing cycle and currency (edited by the superadmin). */
export const planPrice = pgTable(
  "plan_price",
  {
    planKey: text("plan_key").notNull(),
    cycle: text("cycle").notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currency.code),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({ name: "plan_price_pk", columns: [table.planKey, table.cycle, table.currencyCode] }),
    check("plan_price_plan", inList("plan_key", PLAN_KEYS)),
    check("plan_price_cycle", inList("cycle", BILLING_CYCLES)),
    check("plan_price_amount", sql`${table.amountMinor} >= 0`),
  ],
);

/**
 * A company's subscription (exactly one per company). `plan_key` is the plan it has chosen;
 * the plan it actually gets is derived from `status` and the dates (`effectiveSubscription`
 * in src/lib/billing.ts), so a missed renewal job never grants or removes features.
 * `current_period_*` null = no end (free plan, or a pilot given a plan without billing).
 * `scheduled_*` = a downgrade or cycle change applied at the end of the period.
 */
export const subscription = pgTable(
  "subscription",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    planKey: text("plan_key").notNull(),
    status: text("status").notNull(),
    cycle: text("cycle").default("monthly").notNull(),
    currencyCode: text("currency_code")
      .default("USD")
      .notNull()
      .references(() => currency.code),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pauseResumesAt: timestamp("pause_resumes_at", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    scheduledPlanKey: text("scheduled_plan_key"),
    scheduledCycle: text("scheduled_cycle"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check("subscription_plan", inList("plan_key", PLAN_KEYS)),
    check("subscription_status", inList("status", SUBSCRIPTION_STATUSES)),
    check("subscription_cycle", inList("cycle", BILLING_CYCLES)),
    check("subscription_scheduled_plan", inListOrNull("scheduled_plan_key", PLAN_KEYS)),
    check("subscription_scheduled_cycle", inListOrNull("scheduled_cycle", BILLING_CYCLES)),
    check(
      "subscription_period",
      sql`(${table.currentPeriodStart} is null) = (${table.currentPeriodEnd} is null) and (${table.currentPeriodEnd} is null or ${table.currentPeriodEnd} > ${table.currentPeriodStart})`,
    ),
    check("subscription_trial", sql`${table.status} <> 'trialing' or ${table.trialEndsAt} is not null`),
    check("subscription_paused", sql`(${table.status} = 'paused') = (${table.pausedAt} is not null)`),
  ],
);

/**
 * What a company owes for a period (renewal), a plan change (upgrade: the prorated
 * difference) or anything else the superadmin bills by hand. Amount, plan and period are a
 * snapshot. `status` is a cache of its payments, recomputed in the same transaction.
 */
export const subscriptionInvoice = pgTable(
  "subscription_invoice",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    // platform-wide invoice number, shown as QS-000123
    number: integer("number").generatedAlwaysAsIdentity().notNull(),
    tenantId: uuid("tenant_id").references(() => organization.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    kind: text("kind").notNull(),
    planKey: text("plan_key"),
    cycle: text("cycle"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currency.code),
    status: text("status").default("open").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("subscription_invoice_number_unique").on(table.number),
    index("subscription_invoice_tenantId_idx").on(table.tenantId, table.createdAt),
    index("subscription_invoice_status_idx").on(table.status, table.dueAt),
    // the renewal job issues one invoice per period, even when run twice
    uniqueIndex("subscription_invoice_renewal_unique")
      .on(table.tenantId, table.periodStart)
      .where(sql`${table.kind} = 'renewal' and ${table.status} <> 'void'`),
    check("subscription_invoice_kind", inList("kind", INVOICE_KINDS)),
    check("subscription_invoice_status", inList("status", INVOICE_STATUSES)),
    check("subscription_invoice_plan", inListOrNull("plan_key", PLAN_KEYS)),
    check("subscription_invoice_cycle", inListOrNull("cycle", BILLING_CYCLES)),
    check("subscription_invoice_amount", sql`${table.amountMinor} >= 0`),
    check(
      "subscription_invoice_period",
      sql`(${table.periodStart} is null) = (${table.periodEnd} is null) and (${table.periodEnd} is null or ${table.periodEnd} > ${table.periodStart})`,
    ),
    check(
      "subscription_invoice_void",
      sql`(${table.status} = 'void') = (${table.voidedAt} is not null)`,
    ),
  ],
);

/**
 * Money a company paid (or got back) for an invoice, recorded by the superadmin. Always in
 * the invoice's currency, positive; `kind` says the direction. Never deleted: a mistake is
 * corrected with a refund.
 */
export const subscriptionPayment = pgTable(
  "subscription_payment",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => subscriptionInvoice.id, { onDelete: "restrict" }),
    tenantId: uuid("tenant_id").references(() => organization.id, { onDelete: "set null" }),
    kind: text("kind").default("payment").notNull(),
    method: text("method").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currencyCode: text("currency_code")
      .notNull()
      .references(() => currency.code),
    // transfer number, Zelle confirmation...
    reference: text("reference"),
    paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
    recordedByUserId: uuid("recorded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("subscription_payment_invoiceId_idx").on(table.invoiceId),
    index("subscription_payment_paidAt_idx").on(table.paidAt),
    check("subscription_payment_kind", sql`${table.kind} in ('payment', 'refund')`),
    check("subscription_payment_method", inList("method", BILLING_PAYMENT_METHODS)),
    check("subscription_payment_amount", sql`${table.amountMinor} > 0`),
  ],
);

/**
 * Append-only history of every billing operation: plan changes, pauses, invoices, payments,
 * status moves by the renewal job. `before` / `after` = the subscription fields that changed.
 */
export const subscriptionEvent = pgTable(
  "subscription_event",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id").references(() => organization.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    invoiceId: uuid("invoice_id").references(() => subscriptionInvoice.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id").references(() => subscriptionPayment.id, { onDelete: "restrict" }),
    before: jsonb("before"),
    after: jsonb("after"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("subscription_event_tenantId_idx").on(table.tenantId, table.createdAt),
    check("subscription_event_type", inList("type", SUBSCRIPTION_EVENT_TYPES)),
    check("subscription_event_actor", inList("actor", BILLING_ACTORS)),
  ],
);

export const BILLING_REQUEST_KINDS = ["plan", "pause", "other"] as const;
export const BILLING_REQUEST_STATUSES = ["open", "done", "dismissed"] as const;

/**
 * What a company owner asks the superadmin from the Billing page (no payment gateway: a paid
 * plan or a pause needs a person). At most one open request per company: a new one replaces it.
 */
export const billingRequest = pgTable(
  "billing_request",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    planKey: text("plan_key"),
    cycle: text("cycle"),
    message: text("message"),
    status: text("status").default("open").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    handledByUserId: uuid("handled_by_user_id").references(() => user.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("billing_request_open_unique").on(table.tenantId).where(sql`${table.status} = 'open'`),
    index("billing_request_status_idx").on(table.status, table.createdAt),
    check("billing_request_kind", inList("kind", BILLING_REQUEST_KINDS)),
    check("billing_request_status", inList("status", BILLING_REQUEST_STATUSES)),
    check("billing_request_plan", inListOrNull("plan_key", PLAN_KEYS)),
    check("billing_request_cycle", inListOrNull("cycle", BILLING_CYCLES)),
    check("billing_request_handled", sql`(${table.status} = 'open') = (${table.handledAt} is null)`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("impersonation_log_adminUserId_idx").on(table.adminUserId),
    index("impersonation_log_targetUserId_idx").on(table.targetUserId),
    index("impersonation_log_createdAt_idx").on(table.createdAt),
    check("impersonation_log_action", sql`${table.action} in ('start', 'stop')`),
  ],
);
