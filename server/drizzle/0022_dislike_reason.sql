CREATE TYPE "public"."dislike_reason" AS ENUM('style', 'match', 'weather', 'occasion');--> statement-breakpoint
ALTER TABLE "outfit_reactions" ADD COLUMN "reason" "dislike_reason";