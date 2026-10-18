CREATE TABLE "company_role" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preset_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_role_tenant_key_unique" UNIQUE("tenant_id","key"),
	CONSTRAINT "company_role_key_format" CHECK ("company_role"."key" ~ '^[a-z][a-z0-9-]{0,39}$' and "company_role"."key" <> 'owner'),
	CONSTRAINT "company_role_name_not_empty" CHECK (length(trim("company_role"."name")) > 0),
	CONSTRAINT "company_role_permissions_object" CHECK (jsonb_typeof("company_role"."permissions") = 'object')
);
--> statement-breakpoint
ALTER TABLE "company_role" ADD CONSTRAINT "company_role_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_role_tenant_name_unique" ON "company_role" USING btree ("tenant_id",lower("name"));