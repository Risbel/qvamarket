CREATE TABLE "billing_request" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"plan_key" text,
	"cycle" text,
	"message" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_user_id" uuid,
	"handled_by_user_id" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_request_kind" CHECK (kind in ('plan', 'pause', 'other')),
	CONSTRAINT "billing_request_status" CHECK (status in ('open', 'done', 'dismissed')),
	CONSTRAINT "billing_request_plan" CHECK (plan_key is null or plan_key in ('free', 'basic', 'pro', 'business')),
	CONSTRAINT "billing_request_cycle" CHECK (cycle is null or cycle in ('monthly', 'quarterly', 'yearly')),
	CONSTRAINT "billing_request_handled" CHECK (("billing_request"."status" = 'open') = ("billing_request"."handled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "subscription_event" DROP CONSTRAINT "subscription_event_type";--> statement-breakpoint
ALTER TABLE "billing_request" ADD CONSTRAINT "billing_request_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_request" ADD CONSTRAINT "billing_request_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_request" ADD CONSTRAINT "billing_request_handled_by_user_id_user_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_request_open_unique" ON "billing_request" USING btree ("tenant_id") WHERE "billing_request"."status" = 'open';--> statement-breakpoint
CREATE INDEX "billing_request_status_idx" ON "billing_request" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_type" CHECK (type in ('created', 'trial_started', 'trial_ended', 'plan_upgraded', 'downgrade_scheduled', 'downgrade_cancelled', 'plan_downgraded', 'cycle_changed', 'paused', 'resumed', 'cancel_scheduled', 'reactivated', 'cancelled', 'renewed', 'invoice_issued', 'invoice_voided', 'payment_recorded', 'refund_recorded', 'became_past_due', 'expired', 'price_changed', 'period_adjusted', 'trial_adjusted', 'change_requested', 'request_closed'));