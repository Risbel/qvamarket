ALTER TABLE "store" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_status" CHECK ("store"."status" in ('pending', 'active', 'suspended'));--> statement-breakpoint
-- Carry the old flag over: active stores stay public, inactive ones become suspended
UPDATE "store" SET "status" = CASE WHEN "is_active" THEN 'active' ELSE 'suspended' END;
