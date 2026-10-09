ALTER TABLE "store" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "primary_color" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_primary_color_format" CHECK ("store"."primary_color" is null or "store"."primary_color" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_accent_color_format" CHECK ("store"."accent_color" is null or "store"."accent_color" ~ '^#[0-9a-f]{6}$');