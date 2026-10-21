CREATE TABLE "inventory_movement" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"delta" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"unit_cost_minor" bigint,
	"cost_currency_code" text,
	"order_id" uuid,
	"actor_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movement_reason" CHECK (reason in ('initial', 'received', 'sale', 'cancel', 'order_edit', 'adjustment', 'damaged', 'gift', 'return', 'other')),
	CONSTRAINT "inventory_movement_delta" CHECK ("inventory_movement"."delta" <> 0),
	CONSTRAINT "inventory_movement_stock_after" CHECK ("inventory_movement"."stock_after" >= 0),
	CONSTRAINT "inventory_movement_cost" CHECK (("inventory_movement"."unit_cost_minor" is null) = ("inventory_movement"."cost_currency_code" is null) and ("inventory_movement"."unit_cost_minor" is null or "inventory_movement"."unit_cost_minor" >= 0))
);
--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "unit_cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "product_variant" ADD COLUMN "cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "product_variant" ADD COLUMN "cost_currency_code" text;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_cost_currency_code_currency_code_fk" FOREIGN KEY ("cost_currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_variant_store_tenant_fk" FOREIGN KEY ("variant_id","store_id","tenant_id") REFERENCES "public"."product_variant"("id","store_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_order_tenant_fk" FOREIGN KEY ("order_id","tenant_id") REFERENCES "public"."order"("id","tenant_id") ON DELETE SET NULL ("order_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movement_variantId_idx" ON "inventory_movement" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movement_storeId_idx" ON "inventory_movement" USING btree ("store_id","created_at");--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_cost_currency_code_currency_code_fk" FOREIGN KEY ("cost_currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_unit_cost" CHECK ("order_item"."unit_cost_minor" is null or "order_item"."unit_cost_minor" >= 0);--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_cost" CHECK (("product_variant"."cost_minor" is null) = ("product_variant"."cost_currency_code" is null) and ("product_variant"."cost_minor" is null or "product_variant"."cost_minor" >= 0));--> statement-breakpoint
-- Hand-edited: inventory_movement_order_tenant_fk uses SET NULL ("order_id") so tenant_id is
-- kept (same reason as 0008).
-- Hand-written: the new `inventory` permission goes to the manager and catalog roles (read +
-- update) and the viewer roles (read) seeded from the presets
UPDATE "company_role"
SET "permissions" = "permissions" || '{"inventory": ["read", "update"]}'::jsonb
WHERE "preset_key" IN ('manager', 'catalog')
  AND NOT ("permissions" ? 'inventory');--> statement-breakpoint
UPDATE "company_role"
SET "permissions" = "permissions" || '{"inventory": ["read"]}'::jsonb
WHERE "preset_key" = 'viewer'
  AND NOT ("permissions" ? 'inventory');--> statement-breakpoint
-- Hand-written: the stock already counted becomes each tracked variant's first movement
INSERT INTO "inventory_movement" ("tenant_id", "store_id", "variant_id", "reason", "delta", "stock_after", "created_at")
SELECT "tenant_id", "store_id", "id", 'initial', "stock", "stock", "created_at"
FROM "product_variant"
WHERE "stock" > 0;