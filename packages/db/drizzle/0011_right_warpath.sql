-- Hand-edited: order_customer_tenant_fk, order_item_variant_store_tenant_fk and
-- order_item_product_store_tenant_fk use ON DELETE SET NULL (<column>) so tenant_id/store_id
-- are kept (drizzle-kit cannot express a column list).
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "customer_name_not_empty" CHECK (length(trim("customer"."name")) > 0),
	CONSTRAINT "customer_phone_format" CHECK ("customer"."phone" is null or "customer"."phone" ~ '^\+?[0-9]{6,20}$')
);
--> statement-breakpoint
CREATE TABLE "order" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"customer_note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"fulfillment_type" text DEFAULT 'pickup' NOT NULL,
	"currency_code" text NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"delivery_fee_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "order_id_store_id_tenant_id_unique" UNIQUE("id","store_id","tenant_id"),
	CONSTRAINT "order_store_number_unique" UNIQUE("store_id","number"),
	CONSTRAINT "order_store_idempotency_key_unique" UNIQUE("store_id","idempotency_key"),
	CONSTRAINT "order_number_positive" CHECK ("order"."number" > 0),
	CONSTRAINT "order_status" CHECK (status in ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
	CONSTRAINT "order_payment_status" CHECK (payment_status in ('unpaid', 'partial', 'paid', 'refunded')),
	CONSTRAINT "order_fulfillment_type" CHECK ("order"."fulfillment_type" in ('pickup', 'delivery')),
	CONSTRAINT "order_out_for_delivery_only_delivery" CHECK ("order"."status" <> 'out_for_delivery' or "order"."fulfillment_type" = 'delivery'),
	CONSTRAINT "order_customer_name_not_empty" CHECK (length(trim("order"."customer_name")) > 0),
	CONSTRAINT "order_customer_phone_not_empty" CHECK (length(trim("order"."customer_phone")) > 0),
	CONSTRAINT "order_amounts" CHECK ("order"."subtotal_minor" >= 0 and "order"."delivery_fee_minor" >= 0 and "order"."total_minor" = "order"."subtotal_minor" + "order"."delivery_fee_minor")
);
--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid,
	"product_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"product_name" text NOT NULL,
	"variant_title" text,
	"sku" text,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"compare_at_minor" bigint,
	"line_total_minor" bigint NOT NULL,
	"stock_deducted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "order_item_product_name_not_empty" CHECK (length(trim("order_item"."product_name")) > 0),
	CONSTRAINT "order_item_quantity" CHECK ("order_item"."quantity" > 0),
	CONSTRAINT "order_item_unit_price" CHECK ("order_item"."unit_price_minor" >= 0),
	CONSTRAINT "order_item_compare_at" CHECK ("order_item"."compare_at_minor" is null or "order_item"."compare_at_minor" > "order_item"."unit_price_minor"),
	CONSTRAINT "order_item_line_total" CHECK ("order_item"."line_total_minor" = "order_item"."unit_price_minor" * "order_item"."quantity")
);
--> statement-breakpoint
CREATE TABLE "order_payment" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text DEFAULT 'payment' NOT NULL,
	"method" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_payment_kind" CHECK ("order_payment"."kind" in ('payment', 'refund')),
	CONSTRAINT "order_payment_method" CHECK ("order_payment"."method" in ('cash', 'transfer', 'other')),
	CONSTRAINT "order_payment_amount" CHECK ("order_payment"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_history_to_status" CHECK (to_status in ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
	CONSTRAINT "order_status_history_from_status" CHECK (from_status is null or from_status in ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
	CONSTRAINT "order_status_history_actor" CHECK ("order_status_history"."actor" in ('customer', 'merchant', 'system'))
);
--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "last_order_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_customer_tenant_fk" FOREIGN KEY ("customer_id","tenant_id") REFERENCES "public"."customer"("id","tenant_id") ON DELETE SET NULL ("customer_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_store_tenant_fk" FOREIGN KEY ("order_id","store_id","tenant_id") REFERENCES "public"."order"("id","store_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variant_store_tenant_fk" FOREIGN KEY ("variant_id","store_id","tenant_id") REFERENCES "public"."product_variant"("id","store_id","tenant_id") ON DELETE SET NULL ("variant_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_store_tenant_fk" FOREIGN KEY ("product_id","store_id","tenant_id") REFERENCES "public"."product"("id","store_id","tenant_id") ON DELETE SET NULL ("product_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payment" ADD CONSTRAINT "order_payment_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payment" ADD CONSTRAINT "order_payment_order_tenant_fk" FOREIGN KEY ("order_id","tenant_id") REFERENCES "public"."order"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_tenant_fk" FOREIGN KEY ("order_id","tenant_id") REFERENCES "public"."order"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tenant_phone_idx" ON "customer" USING btree ("tenant_id","phone") WHERE "customer"."phone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tenant_user_idx" ON "customer" USING btree ("tenant_id","user_id") WHERE "customer"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "order_storeId_createdAt_idx" ON "order" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "order_storeId_status_idx" ON "order" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "order_customerId_idx" ON "order" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "order_item_orderId_idx" ON "order_item" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "order_item_variantId_idx" ON "order_item" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_item_productId_idx" ON "order_item" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_payment_orderId_idx" ON "order_payment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_orderId_idx" ON "order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_last_order_number" CHECK ("store"."last_order_number" >= 0);