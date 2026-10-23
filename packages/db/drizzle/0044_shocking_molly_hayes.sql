ALTER TABLE "order" DROP CONSTRAINT "order_customer_name_not_empty";--> statement-breakpoint
ALTER TABLE "order" DROP CONSTRAINT "order_customer_phone_not_empty";--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "channel" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "order_payment" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_channel" CHECK (channel in ('online', 'pos'));--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_customer_name_not_empty" CHECK ("order"."channel" = 'pos' or length(trim("order"."customer_name")) > 0);--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_customer_phone_not_empty" CHECK ("order"."channel" = 'pos' or length(trim("order"."customer_phone")) > 0);--> statement-breakpoint
ALTER TABLE "order_payment" ADD CONSTRAINT "order_payment_reference" CHECK ("order_payment"."reference" is null or length(trim("order_payment"."reference")) between 1 and 100);--> statement-breakpoint
-- Hand-written: the new `pos` permission (sell at the counter) goes to the roles seeded from
-- the manager and cashier presets
UPDATE "company_role"
SET "permissions" = "permissions" || '{"pos": ["create"]}'::jsonb
WHERE "preset_key" IN ('manager', 'cashier')
  AND NOT ("permissions" ? 'pos');
