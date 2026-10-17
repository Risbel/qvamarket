ALTER TABLE "store_currency" ADD COLUMN "is_base" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_currency" ADD COLUMN "exchange_rate" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "store_currency" ADD COLUMN "rounding_minor" bigint;--> statement-breakpoint
-- Hand edit: every store starts with its default currency as the base (prices are already typed in it)
UPDATE "store_currency" SET "is_base" = true WHERE "is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "store_currency_one_base_idx" ON "store_currency" USING btree ("store_id") WHERE "store_currency"."is_base";--> statement-breakpoint
ALTER TABLE "store_currency" ADD CONSTRAINT "store_currency_rate_positive" CHECK ("store_currency"."exchange_rate" is null or "store_currency"."exchange_rate" > 0);--> statement-breakpoint
ALTER TABLE "store_currency" ADD CONSTRAINT "store_currency_base_no_rate" CHECK (not ("store_currency"."is_base" and "store_currency"."exchange_rate" is not null));--> statement-breakpoint
ALTER TABLE "store_currency" ADD CONSTRAINT "store_currency_rounding_positive" CHECK ("store_currency"."rounding_minor" is null or "store_currency"."rounding_minor" > 0);