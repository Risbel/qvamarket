CREATE TABLE "register_movement" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"currency_code" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"note" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_movement_kind" CHECK ("register_movement"."kind" in ('in', 'out')),
	CONSTRAINT "register_movement_amount" CHECK ("register_movement"."amount_minor" > 0),
	CONSTRAINT "register_movement_note" CHECK (length(trim("register_movement"."note")) > 0)
);
--> statement-breakpoint
CREATE TABLE "register_session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by_user_id" uuid,
	"opening_note" text,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"closing_note" text,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_session_id_store_tenant_unique" UNIQUE("id","store_id","tenant_id"),
	CONSTRAINT "register_session_store_number_unique" UNIQUE("store_id","number"),
	CONSTRAINT "register_session_status" CHECK ("register_session"."status" in ('open', 'closed')),
	CONSTRAINT "register_session_number" CHECK ("register_session"."number" >= 1),
	CONSTRAINT "register_session_closed" CHECK (("register_session"."status" = 'closed') = ("register_session"."closed_at" is not null) and ("register_session"."closed_at" is null or "register_session"."closed_at" >= "register_session"."opened_at")),
	CONSTRAINT "register_session_report" CHECK (("register_session"."status" = 'closed') = ("register_session"."report" is not null))
);
--> statement-breakpoint
CREATE TABLE "register_session_currency" (
	"session_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"currency_code" text NOT NULL,
	"opening_minor" bigint NOT NULL,
	"expected_minor" bigint,
	"counted_minor" bigint,
	CONSTRAINT "register_session_currency_pk" PRIMARY KEY("session_id","currency_code"),
	CONSTRAINT "register_session_currency_opening" CHECK ("register_session_currency"."opening_minor" >= 0),
	CONSTRAINT "register_session_currency_counted" CHECK ("register_session_currency"."counted_minor" is null or "register_session_currency"."counted_minor" >= 0),
	CONSTRAINT "register_session_currency_closed" CHECK (("register_session_currency"."expected_minor" is null) = ("register_session_currency"."counted_minor" is null))
);
--> statement-breakpoint
ALTER TABLE "register_movement" ADD CONSTRAINT "register_movement_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_movement" ADD CONSTRAINT "register_movement_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_movement" ADD CONSTRAINT "register_movement_session_fk" FOREIGN KEY ("session_id","store_id","tenant_id") REFERENCES "public"."register_session"("id","store_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_session" ADD CONSTRAINT "register_session_opened_by_user_id_user_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_session" ADD CONSTRAINT "register_session_closed_by_user_id_user_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_session" ADD CONSTRAINT "register_session_store_tenant_fk" FOREIGN KEY ("store_id","tenant_id") REFERENCES "public"."store"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_session_currency" ADD CONSTRAINT "register_session_currency_currency_code_currency_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_session_currency" ADD CONSTRAINT "register_session_currency_session_fk" FOREIGN KEY ("session_id","store_id","tenant_id") REFERENCES "public"."register_session"("id","store_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "register_movement_sessionId_idx" ON "register_movement" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "register_session_one_open" ON "register_session" USING btree ("store_id") WHERE "register_session"."status" = 'open';--> statement-breakpoint
CREATE INDEX "register_session_store_closedAt_idx" ON "register_session" USING btree ("store_id","closed_at");--> statement-breakpoint
-- Hand-written: the new `register` permission (day close) goes to the roles seeded from the
-- presets: manager and cashier run the register, viewer reads the reports
UPDATE "company_role"
SET "permissions" = "permissions" || '{"register": ["read", "create", "update"]}'::jsonb
WHERE "preset_key" IN ('manager', 'cashier')
  AND NOT ("permissions" ? 'register');--> statement-breakpoint
UPDATE "company_role"
SET "permissions" = "permissions" || '{"register": ["read"]}'::jsonb
WHERE "preset_key" = 'viewer'
  AND NOT ("permissions" ? 'register');
