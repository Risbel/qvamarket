CREATE TABLE "store_delivery_rate" (
	"store_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"currency_code" text NOT NULL,
	"base_fee_minor" bigint DEFAULT 0 NOT NULL,
	"per_km_minor" bigint DEFAULT 0 NOT NULL,
	"free_above_minor" bigint,
	"min_order_minor" bigint,
	CONSTRAINT "store_delivery_rate_pk" PRIMARY KEY("store_id","currency_code"),
	CONSTRAINT "store_delivery_rate_amounts" CHECK ("store_delivery_rate"."base_fee_minor" >= 0 and "store_delivery_rate"."per_km_minor" >= 0 and ("store_delivery_rate"."free_above_minor" is null or "store_delivery_rate"."free_above_minor" > 0) and ("store_delivery_rate"."min_order_minor" is null or "store_delivery_rate"."min_order_minor" > 0))
);
--> statement-breakpoint
ALTER TABLE "store_delivery" ADD COLUMN "delivery_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_delivery" ADD COLUMN "pickup_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_delivery" ADD COLUMN "fee_mode" text DEFAULT 'flat' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_delivery" ADD COLUMN "base_distance_m" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_delivery_rate" ADD CONSTRAINT "store_delivery_rate_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_delivery_rate" ADD CONSTRAINT "store_delivery_rate_store_currency_fk" FOREIGN KEY ("store_id","currency_code") REFERENCES "public"."store_currency"("store_id","currency_code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_delivery" ADD CONSTRAINT "store_delivery_fee_mode" CHECK (fee_mode in ('free', 'flat', 'distance'));--> statement-breakpoint
ALTER TABLE "store_delivery" ADD CONSTRAINT "store_delivery_base_distance" CHECK ("store_delivery"."base_distance_m" between 0 and 1000000);--> statement-breakpoint
ALTER TABLE "store_delivery" ADD CONSTRAINT "store_delivery_some_fulfillment" CHECK ("store_delivery"."delivery_enabled" or "store_delivery"."pickup_enabled");--> statement-breakpoint
ALTER TABLE "store_delivery" ADD CONSTRAINT "store_delivery_enabled_needs_area" CHECK (not "store_delivery"."delivery_enabled" or ("store_delivery"."location_lat" is not null and "store_delivery"."service_area" is not null));