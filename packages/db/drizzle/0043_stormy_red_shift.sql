DROP INDEX "register_session_one_open";--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "register_session_id" uuid;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "register_session_id" uuid;--> statement-breakpoint
ALTER TABLE "order_payment" ADD COLUMN "register_session_id" uuid;--> statement-breakpoint
ALTER TABLE "register_session" ADD COLUMN "recounts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Hand-moved: the unique constraint must exist before the foreign key that targets it
ALTER TABLE "register_session" ADD CONSTRAINT "register_session_id_tenant_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
-- Hand-edited: SET NULL only the link column (tenant_id / store_id are NOT NULL and shared)
ALTER TABLE "expense" ADD CONSTRAINT "expense_register_session_fk" FOREIGN KEY ("register_session_id","store_id","tenant_id") REFERENCES "public"."register_session"("id","store_id","tenant_id") ON DELETE set null ("register_session_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_register_session_fk" FOREIGN KEY ("register_session_id","store_id","tenant_id") REFERENCES "public"."register_session"("id","store_id","tenant_id") ON DELETE set null ("register_session_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payment" ADD CONSTRAINT "order_payment_register_session_fk" FOREIGN KEY ("register_session_id","tenant_id") REFERENCES "public"."register_session"("id","tenant_id") ON DELETE set null ("register_session_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_registerSessionId_idx" ON "expense" USING btree ("register_session_id");--> statement-breakpoint
CREATE INDEX "order_registerSessionId_idx" ON "order" USING btree ("register_session_id");--> statement-breakpoint
CREATE INDEX "order_payment_registerSessionId_idx" ON "order_payment" USING btree ("register_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "register_session_one_open_per_cashier" ON "register_session" USING btree ("store_id","opened_by_user_id") WHERE "register_session"."status" = 'open';--> statement-breakpoint
-- Hand-written backfill: until now a session covered the store's time [opened_at, closed_at)
-- (one session at a time per store), so link what was paid or created in that window
UPDATE "order_payment" p
SET "register_session_id" = s."id"
FROM "order" o, "register_session" s
WHERE o."id" = p."order_id" AND o."tenant_id" = p."tenant_id"
  AND s."store_id" = o."store_id" AND s."tenant_id" = o."tenant_id"
  AND p."paid_at" >= s."opened_at" AND (s."closed_at" IS NULL OR p."paid_at" < s."closed_at");--> statement-breakpoint
UPDATE "expense" e
SET "register_session_id" = s."id"
FROM "register_session" s
WHERE s."store_id" = e."store_id" AND s."tenant_id" = e."tenant_id"
  AND e."paid_at" >= s."opened_at" AND (s."closed_at" IS NULL OR e."paid_at" < s."closed_at");--> statement-breakpoint
-- Hand-written: `register:supervise` (every cashier's shifts, expected cash, close on their
-- behalf) goes to the roles seeded from the manager preset that run the register
UPDATE "company_role"
SET "permissions" = jsonb_set("permissions", '{register}', ("permissions" -> 'register') || '["supervise"]'::jsonb)
WHERE "preset_key" = 'manager'
  AND jsonb_typeof("permissions" -> 'register') = 'array'
  AND NOT (("permissions" -> 'register') ? 'supervise');
