ALTER TABLE "order" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_storeId_userId_idx" ON "order" USING btree ("store_id","user_id","created_at");