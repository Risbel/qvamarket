CREATE TABLE "favorite" (
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_pk" PRIMARY KEY("customer_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_customer_tenant_fk" FOREIGN KEY ("customer_id","tenant_id") REFERENCES "public"."customer"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_product_store_tenant_fk" FOREIGN KEY ("product_id","store_id","tenant_id") REFERENCES "public"."product"("id","store_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favorite_customer_store_idx" ON "favorite" USING btree ("customer_id","store_id","created_at");