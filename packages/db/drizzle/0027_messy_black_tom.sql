CREATE TABLE "product_upload" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" uuid,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_upload_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "product_upload_size_positive" CHECK ("product_upload"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_upload" ADD CONSTRAINT "product_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_upload" ADD CONSTRAINT "product_upload_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_upload_tenantId_idx" ON "product_upload" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "product_upload_storeId_createdAt_idx" ON "product_upload" USING btree ("store_id","created_at");