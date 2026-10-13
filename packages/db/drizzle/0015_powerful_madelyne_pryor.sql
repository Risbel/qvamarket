CREATE TABLE "store_delivery" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_lat" double precision,
	"location_lng" double precision,
	"service_area" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_delivery_location" CHECK (("store_delivery"."location_lat" is null and "store_delivery"."location_lng" is null) or ("store_delivery"."location_lat" between -90 and 90 and "store_delivery"."location_lng" between -180 and 180)),
	CONSTRAINT "store_delivery_service_area" CHECK (service_area is null or (jsonb_typeof(service_area) = 'array' and jsonb_array_length(service_area) between 3 and 200))
);
--> statement-breakpoint
ALTER TABLE "store_delivery" ADD CONSTRAINT "store_delivery_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;