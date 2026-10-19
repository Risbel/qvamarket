ALTER TABLE "store" ADD COLUMN "time_zone" text DEFAULT 'America/Havana' NOT NULL;--> statement-breakpoint
CREATE INDEX "order_payment_tenantId_paidAt_idx" ON "order_payment" USING btree ("tenant_id","paid_at");--> statement-breakpoint
-- Hand-written: the new `report:read` permission (income summary) goes to the manager and
-- viewer roles seeded from the presets
UPDATE "company_role"
SET "permissions" = "permissions" || '{"report": ["read"]}'::jsonb
WHERE "preset_key" IN ('manager', 'viewer')
  AND NOT ("permissions" ? 'report');
