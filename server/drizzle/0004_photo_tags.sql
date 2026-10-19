CREATE TYPE "public"."tag_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "tag_status" "tag_status";--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "tags" jsonb;