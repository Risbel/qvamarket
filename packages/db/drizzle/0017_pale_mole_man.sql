CREATE TABLE "order_delivery" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"address" text NOT NULL,
	"location_lat" double precision NOT NULL,
	"location_lng" double precision NOT NULL,
	"distance_m" integer NOT NULL,
	"fee_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_delivery_address_not_empty" CHECK (length(trim("order_delivery"."address")) > 0),
	CONSTRAINT "order_delivery_location" CHECK ("order_delivery"."location_lat" between -90 and 90 and "order_delivery"."location_lng" between -180 and 180),
	CONSTRAINT "order_delivery_distance" CHECK ("order_delivery"."distance_m" >= 0),
	CONSTRAINT "order_delivery_fee_mode" CHECK (fee_mode in ('free', 'flat', 'distance'))
);
--> statement-breakpoint
ALTER TABLE "order_delivery" ADD CONSTRAINT "order_delivery_order_store_tenant_fk" FOREIGN KEY ("order_id","store_id","tenant_id") REFERENCES "public"."order"("id","store_id","tenant_id") ON DELETE cascade ON UPDATE no action;