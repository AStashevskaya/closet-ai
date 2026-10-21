ALTER TYPE "public"."photo_kind" ADD VALUE 'inspiration';--> statement-breakpoint
ALTER TYPE "public"."usage_action" ADD VALUE 'inspiration';--> statement-breakpoint
ALTER TABLE "style_briefs" ADD COLUMN "inspiration_count" integer DEFAULT 0 NOT NULL;