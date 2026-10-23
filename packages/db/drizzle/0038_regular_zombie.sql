CREATE TABLE "plan_price" (
	"plan_key" text NOT NULL,
	"cycle" text NOT NULL,
	"currency_code" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_price_pk" PRIMARY KEY("plan_key","cycle","currency_code"),
	CONSTRAINT "plan_price_plan" CHECK (plan_key in ('free', 'basic', 'pro', 'business')),
	CONSTRAINT "plan_price_cycle" CHECK (cycle in ('monthly', 'quarterly', 'yearly')),
	CONSTRAINT "plan_price_amount" CHECK ("plan_price"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"plan_key" text NOT NULL,
	"status" text NOT NULL,
	"cycle" text DEFAULT 'monthly' NOT NULL,
	"currency_code" text DEFAULT 'USD' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"pause_resumes_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"scheduled_plan_key" text,
	"scheduled_cycle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plan" CHECK (plan_key in ('free', 'basic', 'pro', 'business')),
	CONSTRAINT "subscription_status" CHECK (status in ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired')),
	CONSTRAINT "subscription_cycle" CHECK (cycle in ('monthly', 'quarterly', 'yearly')),
	CONSTRAINT "subscription_scheduled_plan" CHECK (scheduled_plan_key is null or scheduled_plan_key in ('free', 'basic', 'pro', 'business')),
	CONSTRAINT "subscription_scheduled_cycle" CHECK (scheduled_cycle is null or scheduled_cycle in ('monthly', 'quarterly', 'yearly')),
	CONSTRAINT "subscription_period" CHECK (("subscription"."current_period_start" is null) = ("subscription"."current_period_end" is null) and ("subscription"."current_period_end" is null or "subscription"."current_period_end" > "subscription"."current_period_start")),
	CONSTRAINT "subscription_trial" CHECK ("subscription"."status" <> 'trialing' or "subscription"."trial_ends_at" is not null),
	CONSTRAINT "subscription_paused" CHECK (("subscription"."status" = 'paused') = ("subscription"."paused_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "subscription_event" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"actor_user_id" uuid,
	"invoice_id" uuid,
	"payment_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_event_type" CHECK (type in ('created', 'trial_started', 'trial_ended', 'plan_upgraded', 'downgrade_scheduled', 'downgrade_cancelled', 'plan_downgraded', 'cycle_changed', 'paused', 'resumed', 'cancel_scheduled', 'reactivated', 'cancelled', 'renewed', 'invoice_issued', 'invoice_voided', 'payment_recorded', 'refund_recorded', 'became_past_due', 'expired', 'price_changed')),
	CONSTRAINT "subscription_event_actor" CHECK (actor in ('admin', 'owner', 'system'))
);
--> statement-breakpoint
CREATE TABLE "subscription_invoice" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "subscription_invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" uuid,
	"company_name" text NOT NULL,
	"kind" text NOT NULL,
	"plan_key" text,
	"cycle" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"amount_minor" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoice_number_unique" UNIQUE("number"),
	CONSTRAINT "subscription_invoice_kind" CHECK (kind in ('renewal', 'upgrade', 'manual')),
	CONSTRAINT "subscription_invoice_status" CHECK (status in ('open', 'partial', 'paid', 'void')),
	CONSTRAINT "subscription_invoice_plan" CHECK (plan_key is null or plan_key in ('free', 'basic', 'pro', 'business')),
	CONSTRAINT "subscription_invoice_cycle" CHECK (cycle is null or cycle in ('monthly', 'quarterly', 'yearly')),
	CONSTRAINT "subscription_invoice_amount" CHECK ("subscription_invoice"."amount_minor" >= 0),
	CONSTRAINT "subscription_invoice_period" CHECK (("subscription_invoice"."period_start" is null) = ("subscription_invoice"."period_end" is null) and ("subscription_invoice"."period_end" is null or "subscription_invoice"."period_end" > "subscription_invoice"."period_start")),
	CONSTRAINT "subscription_invoice_void" CHECK (("subscription_invoice"."status" = 'void') = ("subscription_invoice"."voided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "subscription_payment" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"tenant_id" uuid,
	"kind" text DEFAULT 'payment' NOT NULL,
	"method" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payment_kind" CHECK ("subscription_payment"."kind" in ('payment', 'refund')),
	CONSTRAINT "subscription_payment_method" CHECK (method in ('cash', 'transfer', 'zelle', 'other')),
	CONSTRAINT "subscription_payment_amount" CHECK ("subscription_payment"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_invoice_id_subscription_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."subscription_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_event" ADD CONSTRAINT "subscription_event_payment_id_subscription_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."subscription_payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoice" ADD CONSTRAINT "subscription_invoice_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_invoice_id_subscription_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."subscription_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_event_tenantId_idx" ON "subscription_event" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_invoice_tenantId_idx" ON "subscription_invoice" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_invoice_status_idx" ON "subscription_invoice" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoice_renewal_unique" ON "subscription_invoice" USING btree ("tenant_id","period_start") WHERE "subscription_invoice"."kind" = 'renewal' and "subscription_invoice"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "subscription_payment_invoiceId_idx" ON "subscription_payment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "subscription_payment_paidAt_idx" ON "subscription_payment" USING btree ("paid_at");--> statement-breakpoint
-- Hand-written: starting prices in USD (the superadmin edits them later). Free has no price.
INSERT INTO "plan_price" ("plan_key", "cycle", "currency_code", "amount_minor") VALUES
	('basic', 'monthly', 'USD', 900), ('basic', 'quarterly', 'USD', 2500), ('basic', 'yearly', 'USD', 9000),
	('pro', 'monthly', 'USD', 2500), ('pro', 'quarterly', 'USD', 6900), ('pro', 'yearly', 'USD', 25000),
	('business', 'monthly', 'USD', 5900), ('business', 'quarterly', 'USD', 15900), ('business', 'yearly', 'USD', 59000)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Hand-written: companies from before plans keep everything they use (the top plan, no end
-- date, nothing billed) until the superadmin moves them to a paid plan.
INSERT INTO "subscription" ("tenant_id", "plan_key", "status")
SELECT "id", 'business', 'active' FROM "organization"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "subscription_event" ("tenant_id", "type", "actor", "after", "note")
SELECT "id", 'created', 'system', '{"planKey":"business","status":"active"}'::jsonb, 'Existing company before plans'
FROM "organization";
