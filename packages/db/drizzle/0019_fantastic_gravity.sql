DROP INDEX "store_banner_image_storeId_position_idx";--> statement-breakpoint
ALTER TABLE "store_banner_image" ADD COLUMN "device" text DEFAULT 'desktop' NOT NULL;--> statement-breakpoint
CREATE INDEX "store_banner_image_storeId_device_position_idx" ON "store_banner_image" USING btree ("store_id","device","position");--> statement-breakpoint
ALTER TABLE "store_banner_image" ADD CONSTRAINT "store_banner_image_device" CHECK (device in ('desktop', 'mobile'));