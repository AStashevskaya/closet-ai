CREATE TYPE "public"."photo_kind" AS ENUM('item', 'look');--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "kind" "photo_kind" DEFAULT 'item' NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "look_items" jsonb;