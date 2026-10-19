ALTER TYPE "public"."photo_kind" ADD VALUE 'want';--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "matches" jsonb;