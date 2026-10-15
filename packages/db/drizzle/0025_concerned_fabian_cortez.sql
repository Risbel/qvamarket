CREATE TABLE "store_page" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"meta_title" text,
	"meta_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_page_store_slug_unique" UNIQUE("store_id","slug"),
	CONSTRAINT "store_page_title_not_empty" CHECK (length(trim("store_page"."title")) > 0),
	CONSTRAINT "store_page_slug_format" CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
	CONSTRAINT "store_page_status" CHECK ("store_page"."status" in ('draft', 'published'))
);
--> statement-breakpoint
ALTER TABLE "store_page" ADD CONSTRAINT "store_page_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_page_tenantId_idx" ON "store_page" USING btree ("tenant_id");