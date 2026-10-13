CREATE TABLE "store_secondary_banner_pair" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"device" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"left_storage_key" text,
	"left_content_type" text,
	"left_size_bytes" integer,
	"right_storage_key" text,
	"right_content_type" text,
	"right_size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_secondary_banner_pair_left_storage_key_unique" UNIQUE("left_storage_key"),
	CONSTRAINT "store_secondary_banner_pair_right_storage_key_unique" UNIQUE("right_storage_key"),
	CONSTRAINT "store_secondary_banner_pair_device" CHECK (device in ('desktop', 'mobile')),
	CONSTRAINT "store_secondary_banner_pair_position" CHECK ("store_secondary_banner_pair"."position" >= 0),
	CONSTRAINT "store_secondary_banner_pair_left" CHECK (("store_secondary_banner_pair"."left_storage_key" is null and "store_secondary_banner_pair"."left_content_type" is null and "store_secondary_banner_pair"."left_size_bytes" is null) or ("store_secondary_banner_pair"."left_storage_key" is not null and "store_secondary_banner_pair"."left_content_type" is not null and "store_secondary_banner_pair"."left_size_bytes" > 0)),
	CONSTRAINT "store_secondary_banner_pair_right" CHECK (("store_secondary_banner_pair"."right_storage_key" is null and "store_secondary_banner_pair"."right_content_type" is null and "store_secondary_banner_pair"."right_size_bytes" is null) or ("store_secondary_banner_pair"."right_storage_key" is not null and "store_secondary_banner_pair"."right_content_type" is not null and "store_secondary_banner_pair"."right_size_bytes" > 0))
);
--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "secondary_banner_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_secondary_banner_pair" ADD CONSTRAINT "store_secondary_banner_pair_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_secondary_banner_pair_tenantId_idx" ON "store_secondary_banner_pair" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "store_secondary_banner_pair_storeId_device_position_idx" ON "store_secondary_banner_pair" USING btree ("store_id","device","position");