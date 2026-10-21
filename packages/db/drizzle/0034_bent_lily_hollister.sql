ALTER TABLE "store" ADD COLUMN "theme_radius" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "theme_base" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "theme_tinted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_theme_radius" CHECK (theme_radius is null or theme_radius in ('0', '0.3', '0.5', '0.625', '0.75', '1'));--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_theme_base" CHECK (theme_base is null or theme_base in ('neutral', 'stone', 'zinc', 'gray', 'slate'));