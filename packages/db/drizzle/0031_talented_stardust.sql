CREATE TABLE "invitation_access" (
	"invitation_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_ids" uuid[]
);
--> statement-breakpoint
CREATE TABLE "member_access" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_access_scope" CHECK ("member_access"."scope" in ('all', 'stores'))
);
--> statement-breakpoint
CREATE TABLE "member_store" (
	"member_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "member_store_pk" PRIMARY KEY("member_id","store_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_access" ADD CONSTRAINT "invitation_access_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_access" ADD CONSTRAINT "invitation_access_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_access" ADD CONSTRAINT "member_access_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_access" ADD CONSTRAINT "member_access_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_store" ADD CONSTRAINT "member_store_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_store" ADD CONSTRAINT "member_store_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_store_storeId_idx" ON "member_store" USING btree ("store_id");