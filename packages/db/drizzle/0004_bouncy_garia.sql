CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer NOT NULL,
	"stock" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "product_name_not_empty" CHECK (length(trim("product"."name")) > 0),
	CONSTRAINT "product_price_non_negative" CHECK ("product"."price_minor" >= 0),
	CONSTRAINT "product_stock_non_negative" CHECK ("product"."stock" is null or "product"."stock" >= 0),
	CONSTRAINT "product_status" CHECK ("product"."status" in ('draft', 'active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "product_image" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alt_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_image_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "product_image_size_positive" CHECK ("product_image"."size_bytes" > 0),
	CONSTRAINT "product_image_position" CHECK ("product_image"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
-- store(id, tenant_id) must be unique BEFORE the composite FKs that reference it
ALTER TABLE "store" ADD CONSTRAINT "store_id_tenant_id_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_tenant_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."product"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_tenantId_idx" ON "product" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "product_storeId_status_idx" ON "product" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "product_image_tenantId_idx" ON "product_image" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "product_image_productId_position_idx" ON "product_image" USING btree ("product_id","position");--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_currency_format" CHECK ("store"."currency" ~ '^[A-Z]{3}$');