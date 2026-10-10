ALTER TABLE "product" DROP CONSTRAINT "product_price_non_negative";--> statement-breakpoint
ALTER TABLE "product" DROP CONSTRAINT "product_stock_non_negative";--> statement-breakpoint
ALTER TABLE "product" DROP CONSTRAINT "product_slug_format";--> statement-breakpoint
ALTER TABLE "store" DROP CONSTRAINT "store_currency_format";--> statement-breakpoint
ALTER TABLE "product" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product" DROP COLUMN "price_minor";--> statement-breakpoint
ALTER TABLE "product" DROP COLUMN "stock";--> statement-breakpoint
ALTER TABLE "store" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_slug_format" CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$');