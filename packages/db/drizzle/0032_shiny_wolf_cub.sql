CREATE TABLE "order_edit" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"changes" jsonb NOT NULL,
	"subtotal_before_minor" bigint NOT NULL,
	"subtotal_after_minor" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_edit_changes_array" CHECK (jsonb_typeof("order_edit"."changes") = 'array'),
	CONSTRAINT "order_edit_subtotals" CHECK ("order_edit"."subtotal_after_minor" >= 0 and "order_edit"."subtotal_after_minor" <= "order_edit"."subtotal_before_minor")
);
--> statement-breakpoint
ALTER TABLE "order_item" DROP CONSTRAINT "order_item_quantity";--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "original_quantity" integer;--> statement-breakpoint
ALTER TABLE "order_edit" ADD CONSTRAINT "order_edit_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_edit" ADD CONSTRAINT "order_edit_order_tenant_fk" FOREIGN KEY ("order_id","tenant_id") REFERENCES "public"."order"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_edit_orderId_idx" ON "order_edit" USING btree ("order_id","created_at");--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_quantity" CHECK (("order_item"."quantity" > 0 or ("order_item"."quantity" = 0 and "order_item"."original_quantity" is not null)) and ("order_item"."original_quantity" is null or "order_item"."quantity" < "order_item"."original_quantity"));--> statement-breakpoint
-- Hand-written: the new `order:edit` permission goes to the manager and cashier roles seeded
-- from the presets, where they can still cancel orders (a role edited to drop that is left alone)
UPDATE "company_role"
SET "permissions" = jsonb_set("permissions", '{order}', ("permissions"->'order') || '["edit"]'::jsonb)
WHERE "preset_key" IN ('manager', 'cashier')
  AND "permissions"->'order' ? 'cancel'
  AND NOT ("permissions"->'order' ? 'edit');
