CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"method" text NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payee" text,
	"member_user_id" uuid,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_category" CHECK (category in ('salaries', 'rent', 'utilities', 'transport', 'maintenance', 'marketing', 'taxes', 'fees', 'supplies', 'other')),
	CONSTRAINT "expense_method" CHECK ("expense"."method" in ('cash', 'transfer', 'other')),
	CONSTRAINT "expense_amount" CHECK ("expense"."amount_minor" > 0),
	CONSTRAINT "expense_payee_not_empty" CHECK ("expense"."payee" is null or length(trim("expense"."payee")) > 0)
);
--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_member_user_id_user_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_storeId_paidAt_idx" ON "expense" USING btree ("store_id","paid_at");--> statement-breakpoint
-- Hand-written: the new `expense` permission goes to the manager (everything) and viewer
-- (read) roles seeded from the presets
UPDATE "company_role"
SET "permissions" = "permissions" || '{"expense": ["read", "create", "update", "delete"]}'::jsonb
WHERE "preset_key" = 'manager'
  AND NOT ("permissions" ? 'expense');--> statement-breakpoint
UPDATE "company_role"
SET "permissions" = "permissions" || '{"expense": ["read"]}'::jsonb
WHERE "preset_key" = 'viewer'
  AND NOT ("permissions" ? 'expense');
