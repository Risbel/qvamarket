CREATE TABLE "plan_setting" (
	"plan_key" text PRIMARY KEY NOT NULL,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_offered" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_setting_plan" CHECK (plan_key in ('free', 'basic', 'pro', 'business')),
	CONSTRAINT "plan_setting_features" CHECK (features <@ array['customers', 'promotions', 'inventory', 'expenses', 'advancedReports', 'theme', 'secondaryBanner', 'distanceFees', 'bulkPrices', 'customRoles', 'storeAccess', 'hideBadge', 'dayClose']::text[])
);
--> statement-breakpoint
ALTER TABLE "subscription_event" DROP CONSTRAINT "subscription_event_type";--> statement-breakpoint
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_type" CHECK (type in ('created', 'trial_started', 'trial_ended', 'plan_upgraded', 'downgrade_scheduled', 'downgrade_cancelled', 'plan_downgraded', 'cycle_changed', 'paused', 'resumed', 'cancel_scheduled', 'reactivated', 'cancelled', 'renewed', 'invoice_issued', 'invoice_voided', 'payment_recorded', 'refund_recorded', 'became_past_due', 'expired', 'price_changed', 'plan_updated', 'period_adjusted', 'trial_adjusted', 'change_requested', 'request_closed'));--> statement-breakpoint
-- Hand-written: seed one row per plan with the features the plans had in the code until now
INSERT INTO "plan_setting" ("plan_key", "features") VALUES
	('free', '{}'::text[]),
	('basic', array['customers', 'hideBadge']::text[]),
	('pro', array['customers', 'promotions', 'inventory', 'expenses', 'advancedReports', 'theme', 'secondaryBanner', 'distanceFees', 'bulkPrices', 'customRoles', 'hideBadge', 'dayClose']::text[]),
	('business', array['customers', 'promotions', 'inventory', 'expenses', 'advancedReports', 'theme', 'secondaryBanner', 'distanceFees', 'bulkPrices', 'customRoles', 'storeAccess', 'hideBadge', 'dayClose']::text[])
ON CONFLICT ("plan_key") DO NOTHING;
