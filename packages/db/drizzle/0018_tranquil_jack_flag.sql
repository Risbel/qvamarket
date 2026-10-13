CREATE TABLE "store_banner_image" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_banner_image_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "store_banner_image_size_positive" CHECK ("store_banner_image"."size_bytes" > 0),
	CONSTRAINT "store_banner_image_position" CHECK ("store_banner_image"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store_banner_image" ADD CONSTRAINT "store_banner_image_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_banner_image_tenantId_idx" ON "store_banner_image" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "store_banner_image_storeId_position_idx" ON "store_banner_image" USING btree ("store_id","position");