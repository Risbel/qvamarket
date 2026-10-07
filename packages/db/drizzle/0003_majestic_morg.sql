CREATE TABLE "impersonation_log" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"admin_user_id" uuid,
	"admin_email" text NOT NULL,
	"target_user_id" uuid,
	"target_email" text NOT NULL,
	"tenant_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "impersonation_log_action" CHECK ("impersonation_log"."action" in ('start', 'stop'))
);
--> statement-breakpoint
ALTER TABLE "impersonation_log" ADD CONSTRAINT "impersonation_log_admin_user_id_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_log" ADD CONSTRAINT "impersonation_log_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_log" ADD CONSTRAINT "impersonation_log_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "impersonation_log_adminUserId_idx" ON "impersonation_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "impersonation_log_targetUserId_idx" ON "impersonation_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "impersonation_log_createdAt_idx" ON "impersonation_log" USING btree ("created_at");