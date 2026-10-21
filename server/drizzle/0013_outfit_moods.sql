CREATE TYPE "public"."outfit_mood" AS ENUM('everyday', 'office', 'evening', 'sporty', 'surprise');--> statement-breakpoint
ALTER TABLE "outfit_requests" ADD COLUMN "mood" "outfit_mood";