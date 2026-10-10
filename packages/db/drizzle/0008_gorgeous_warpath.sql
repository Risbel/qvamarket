CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "category_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "category_store_slug_unique" UNIQUE("store_id","slug"),
	CONSTRAINT "category_name_not_empty" CHECK (length(trim("category"."name")) > 0),
	CONSTRAINT "category_slug_format" CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
	CONSTRAINT "category_not_own_parent" CHECK ("category"."parent_id" is null or "category"."parent_id" <> "category"."id")
);
--> statement-breakpoint
CREATE TABLE "currency" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"digits" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "currency_code_format" CHECK ("currency"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currency_digits" CHECK ("currency"."digits" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "price_list" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'sale' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "price_list_name_not_empty" CHECK (length(trim("price_list"."name")) > 0),
	CONSTRAINT "price_list_kind" CHECK ("price_list"."kind" in ('sale', 'override')),
	CONSTRAINT "price_list_status" CHECK ("price_list"."status" in ('draft', 'active')),
	CONSTRAINT "price_list_dates" CHECK ("price_list"."starts_at" is null or "price_list"."ends_at" is null or "price_list"."ends_at" > "price_list"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "product_option" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_option_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "product_option_product_name_unique" UNIQUE("product_id","name"),
	CONSTRAINT "product_option_name_not_empty" CHECK (length(trim("product_option"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "product_option_value" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"value" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_option_value_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "product_option_value_option_value_unique" UNIQUE("option_id","value"),
	CONSTRAINT "product_option_value_not_empty" CHECK (length(trim("product_option_value"."value")) > 0)
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text,
	"title" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"stock" integer,
	"weight_grams" integer,
	"option_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "product_variant_id_store_id_tenant_id_unique" UNIQUE("id","store_id","tenant_id"),
	CONSTRAINT "product_variant_product_option_key_unique" UNIQUE("product_id","option_key"),
	CONSTRAINT "product_variant_stock_non_negative" CHECK ("product_variant"."stock" is null or "product_variant"."stock" >= 0),
	CONSTRAINT "product_variant_weight_positive" CHECK ("product_variant"."weight_grams" is null or "product_variant"."weight_grams" > 0),
	CONSTRAINT "product_variant_sku_not_empty" CHECK ("product_variant"."sku" is null or length(trim("product_variant"."sku")) > 0)
);
--> statement-breakpoint
CREATE TABLE "store_currency" (
	"store_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"currency_code" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "store_currency_pk" PRIMARY KEY("store_id","currency_code")
);
--> statement-breakpoint
CREATE TABLE "variant_option_value" (
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL,
	CONSTRAINT "variant_option_value_pk" PRIMARY KEY("variant_id","option_value_id")
);
--> statement-breakpoint
CREATE TABLE "variant_price" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"currency_code" text NOT NULL,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"amount_minor" bigint NOT NULL,
	"compare_at_minor" bigint,
	"price_list_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "variant_price_unique" UNIQUE NULLS NOT DISTINCT("variant_id","currency_code","min_quantity","price_list_id"),
	CONSTRAINT "variant_price_min_quantity" CHECK ("variant_price"."min_quantity" >= 1),
	CONSTRAINT "variant_price_amount" CHECK ("variant_price"."amount_minor" >= 0),
	CONSTRAINT "variant_price_compare_at" CHECK ("variant_price"."compare_at_minor" is null or "variant_price"."compare_at_minor" > "variant_price"."amount_minor")
);
--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "meta_title" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "meta_description" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "pickup_instructions" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "opening_hours" jsonb;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "meta_title" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "meta_description" text;--> statement-breakpoint
-- referenced by product_variant's composite FK: must exist first
ALTER TABLE "product" ADD CONSTRAINT "product_id_store_id_tenant_id_unique" UNIQUE("id","store_id","tenant_id");--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_tenant_fk" FOREIGN KEY ("parent_id","tenant_id") REFERENCES "public"."category"("id","tenant_id") ON DELETE SET NULL ("parent_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_product_tenant_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."product"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_option_tenant_fk" FOREIGN KEY ("option_id","tenant_id") REFERENCES "public"."product_option"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_store_tenant_fk" FOREIGN KEY ("product_id","store_id","tenant_id") REFERENCES "public"."product"("id","store_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_currency" ADD CONSTRAINT "store_currency_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_currency" ADD CONSTRAINT "store_currency_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_value" ADD CONSTRAINT "variant_option_value_variant_tenant_fk" FOREIGN KEY ("variant_id","tenant_id") REFERENCES "public"."product_variant"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_value" ADD CONSTRAINT "variant_option_value_value_tenant_fk" FOREIGN KEY ("option_value_id","tenant_id") REFERENCES "public"."product_option_value"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price" ADD CONSTRAINT "variant_price_variant_store_tenant_fk" FOREIGN KEY ("variant_id","store_id","tenant_id") REFERENCES "public"."product_variant"("id","store_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price" ADD CONSTRAINT "variant_price_store_currency_fk" FOREIGN KEY ("store_id","currency_code") REFERENCES "public"."store_currency"("store_id","currency_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price" ADD CONSTRAINT "variant_price_price_list_tenant_fk" FOREIGN KEY ("price_list_id","tenant_id") REFERENCES "public"."price_list"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_storeId_position_idx" ON "category" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "price_list_storeId_idx" ON "price_list" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_one_default_idx" ON "product_variant" USING btree ("product_id") WHERE "product_variant"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_tenant_sku_idx" ON "product_variant" USING btree ("tenant_id","sku") WHERE "product_variant"."sku" is not null;--> statement-breakpoint
CREATE INDEX "product_variant_productId_idx" ON "product_variant" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_currency_one_default_idx" ON "store_currency" USING btree ("store_id") WHERE "store_currency"."is_default";--> statement-breakpoint
CREATE INDEX "variant_price_variant_currency_idx" ON "variant_price" USING btree ("variant_id","currency_code");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_tenant_fk" FOREIGN KEY ("category_id","tenant_id") REFERENCES "public"."category"("id","tenant_id") ON DELETE SET NULL ("category_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_categoryId_idx" ON "product" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "product_tags_idx" ON "product" USING gin ("tags");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_store_slug_unique" UNIQUE("store_id","slug");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_slug_format" CHECK (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$');--> statement-breakpoint
-- catalog v2 backfill ------------------------------------------------------------------
-- Currencies known to the platform (ISO 4217, 162 codes)
INSERT INTO "currency" ("code", "name", "digits") VALUES
('AED', 'United Arab Emirates Dirham', 2),
('AFN', 'Afghan Afghani', 0),
('ALL', 'Albanian Lek', 0),
('AMD', 'Armenian Dram', 2),
('ANG', 'Netherlands Antillean Guilder', 2),
('AOA', 'Angolan Kwanza', 2),
('ARS', 'Argentine Peso', 2),
('AUD', 'Australian Dollar', 2),
('AWG', 'Aruban Florin', 2),
('AZN', 'Azerbaijani Manat', 2),
('BAM', 'Bosnia-Herzegovina Convertible Mark', 2),
('BBD', 'Barbadian Dollar', 2),
('BDT', 'Bangladeshi Taka', 2),
('BGN', 'Bulgarian Lev', 2),
('BHD', 'Bahraini Dinar', 3),
('BIF', 'Burundian Franc', 0),
('BMD', 'Bermudan Dollar', 2),
('BND', 'Brunei Dollar', 2),
('BOB', 'Bolivian Boliviano', 2),
('BRL', 'Brazilian Real', 2),
('BSD', 'Bahamian Dollar', 2),
('BTN', 'Bhutanese Ngultrum', 2),
('BWP', 'Botswanan Pula', 2),
('BYN', 'Belarusian Ruble', 2),
('BZD', 'Belize Dollar', 2),
('CAD', 'Canadian Dollar', 2),
('CDF', 'Congolese Franc', 2),
('CHF', 'Swiss Franc', 2),
('CLP', 'Chilean Peso', 0),
('CNY', 'Chinese Yuan', 2),
('COP', 'Colombian Peso', 0),
('CRC', 'Costa Rican Colón', 2),
('CUC', 'Cuban Convertible Peso', 2),
('CUP', 'Cuban Peso', 2),
('CVE', 'Cape Verdean Escudo', 2),
('CZK', 'Czech Koruna', 2),
('DJF', 'Djiboutian Franc', 0),
('DKK', 'Danish Krone', 2),
('DOP', 'Dominican Peso', 2),
('DZD', 'Algerian Dinar', 2),
('EGP', 'Egyptian Pound', 2),
('ERN', 'Eritrean Nakfa', 2),
('ETB', 'Ethiopian Birr', 2),
('EUR', 'Euro', 2),
('FJD', 'Fijian Dollar', 2),
('FKP', 'Falkland Islands Pound', 2),
('GBP', 'British Pound', 2),
('GEL', 'Georgian Lari', 2),
('GHS', 'Ghanaian Cedi', 2),
('GIP', 'Gibraltar Pound', 2),
('GMD', 'Gambian Dalasi', 2),
('GNF', 'Guinean Franc', 0),
('GTQ', 'Guatemalan Quetzal', 2),
('GYD', 'Guyanaese Dollar', 2),
('HKD', 'Hong Kong Dollar', 2),
('HNL', 'Honduran Lempira', 2),
('HRK', 'Croatian Kuna', 2),
('HTG', 'Haitian Gourde', 2),
('HUF', 'Hungarian Forint', 0),
('IDR', 'Indonesian Rupiah', 0),
('ILS', 'Israeli New Shekel', 2),
('INR', 'Indian Rupee', 2),
('IQD', 'Iraqi Dinar', 0),
('IRR', 'Iranian Rial', 0),
('ISK', 'Icelandic Króna', 0),
('JMD', 'Jamaican Dollar', 2),
('JOD', 'Jordanian Dinar', 3),
('JPY', 'Japanese Yen', 0),
('KES', 'Kenyan Shilling', 2),
('KGS', 'Kyrgyz Som', 2),
('KHR', 'Cambodian Riel', 2),
('KMF', 'Comorian Franc', 0),
('KPW', 'North Korean Won', 0),
('KRW', 'South Korean Won', 0),
('KWD', 'Kuwaiti Dinar', 3),
('KYD', 'Cayman Islands Dollar', 2),
('KZT', 'Kazakhstani Tenge', 2),
('LAK', 'Laotian Kip', 0),
('LBP', 'Lebanese Pound', 0),
('LKR', 'Sri Lankan Rupee', 2),
('LRD', 'Liberian Dollar', 2),
('LSL', 'Lesotho Loti', 2),
('LYD', 'Libyan Dinar', 3),
('MAD', 'Moroccan Dirham', 2),
('MDL', 'Moldovan Leu', 2),
('MGA', 'Malagasy Ariary', 0),
('MKD', 'Macedonian Denar', 2),
('MMK', 'Myanmar Kyat', 0),
('MNT', 'Mongolian Tugrik', 2),
('MOP', 'Macanese Pataca', 2),
('MRU', 'Mauritanian Ouguiya', 2),
('MUR', 'Mauritian Rupee', 2),
('MVR', 'Maldivian Rufiyaa', 2),
('MWK', 'Malawian Kwacha', 2),
('MXN', 'Mexican Peso', 2),
('MYR', 'Malaysian Ringgit', 2),
('MZN', 'Mozambican Metical', 2),
('NAD', 'Namibian Dollar', 2),
('NGN', 'Nigerian Naira', 2),
('NIO', 'Nicaraguan Córdoba', 2),
('NOK', 'Norwegian Krone', 2),
('NPR', 'Nepalese Rupee', 2),
('NZD', 'New Zealand Dollar', 2),
('OMR', 'Omani Rial', 3),
('PAB', 'Panamanian Balboa', 2),
('PEN', 'Peruvian Sol', 2),
('PGK', 'Papua New Guinean Kina', 2),
('PHP', 'Philippine Peso', 2),
('PKR', 'Pakistani Rupee', 0),
('PLN', 'Polish Zloty', 2),
('PYG', 'Paraguayan Guarani', 0),
('QAR', 'Qatari Riyal', 2),
('RON', 'Romanian Leu', 2),
('RSD', 'Serbian Dinar', 2),
('RUB', 'Russian Ruble', 2),
('RWF', 'Rwandan Franc', 0),
('SAR', 'Saudi Riyal', 2),
('SBD', 'Solomon Islands Dollar', 2),
('SCR', 'Seychellois Rupee', 2),
('SDG', 'Sudanese Pound', 2),
('SEK', 'Swedish Krona', 2),
('SGD', 'Singapore Dollar', 2),
('SHP', 'St. Helena Pound', 2),
('SLE', 'Sierra Leonean Leone', 2),
('SLL', 'Sierra Leonean Leone (1964—2022)', 0),
('SOS', 'Somali Shilling', 0),
('SRD', 'Surinamese Dollar', 2),
('SSP', 'South Sudanese Pound', 2),
('STN', 'São Tomé & Príncipe Dobra', 2),
('SVC', 'Salvadoran Colón', 2),
('SYP', 'Syrian Pound', 0),
('SZL', 'Swazi Lilangeni', 2),
('THB', 'Thai Baht', 2),
('TJS', 'Tajikistani Somoni', 2),
('TMT', 'Turkmenistani Manat', 2),
('TND', 'Tunisian Dinar', 3),
('TOP', 'Tongan Paʻanga', 2),
('TRY', 'Turkish Lira', 2),
('TTD', 'Trinidad & Tobago Dollar', 2),
('TWD', 'New Taiwan Dollar', 2),
('TZS', 'Tanzanian Shilling', 2),
('UAH', 'Ukrainian Hryvnia', 2),
('UGX', 'Ugandan Shilling', 0),
('USD', 'US Dollar', 2),
('UYU', 'Uruguayan Peso', 2),
('UZS', 'Uzbekistani Som', 2),
('VES', 'Venezuelan Bolívar', 2),
('VND', 'Vietnamese Dong', 0),
('VUV', 'Vanuatu Vatu', 0),
('WST', 'Samoan Tala', 2),
('XAF', 'Central African CFA Franc', 0),
('XCD', 'East Caribbean Dollar', 2),
('XCG', 'Caribbean guilder', 2),
('XDR', 'Special Drawing Rights', 2),
('XOF', 'West African CFA Franc', 0),
('XPF', 'CFP Franc', 0),
('XSU', 'Sucre', 2),
('YER', 'Yemeni Rial', 0),
('ZAR', 'South African Rand', 2),
('ZMW', 'Zambian Kwacha', 2),
('ZWG', 'Zimbabwean Gold', 2),
('ZWL', 'Zimbabwean Dollar (2009–2024)', 2)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Each store sells in its old single currency, which becomes the default
INSERT INTO "store_currency" ("store_id", "tenant_id", "currency_code", "is_default", "position")
SELECT "id", "tenant_id", "currency", true, 0 FROM "store";--> statement-breakpoint
-- Product slugs from the name (accents removed); duplicates in a store get a short id suffix
WITH base AS (
  SELECT "id", "store_id", "created_at",
    coalesce(nullif(left(trim(both '-' from regexp_replace(lower(translate("name", 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')), '[^a-z0-9]+', '-', 'g')), 70), ''), 'producto') AS slug
  FROM "product"
), numbered AS (
  SELECT "id", trim(both '-' from slug) AS slug,
    row_number() OVER (PARTITION BY "store_id", slug ORDER BY "created_at", "id") AS rn
  FROM base
)
UPDATE "product" p
SET "slug" = CASE WHEN n.rn = 1 THEN n.slug ELSE n.slug || '-' || left(p."id"::text, 6) END
FROM numbered n WHERE n."id" = p."id";--> statement-breakpoint
-- Every existing product becomes a simple product: one default variant with its stock...
INSERT INTO "product_variant" ("tenant_id", "store_id", "product_id", "position", "is_default", "stock", "option_key")
SELECT "tenant_id", "store_id", "id", 0, true, "stock", '' FROM "product";--> statement-breakpoint
-- ...and its price in the store's (default) currency
INSERT INTO "variant_price" ("tenant_id", "store_id", "variant_id", "currency_code", "min_quantity", "amount_minor")
SELECT v."tenant_id", v."store_id", v."id", sc."currency_code", 1, p."price_minor"
FROM "product_variant" v
JOIN "product" p ON p."id" = v."product_id"
JOIN "store_currency" sc ON sc."store_id" = v."store_id" AND sc."is_default";
