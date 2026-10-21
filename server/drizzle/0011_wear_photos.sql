ALTER TYPE "public"."photo_kind" ADD VALUE 'wear';--> statement-breakpoint
ALTER TABLE "outfit_requests" ADD COLUMN "hero_photo_key" text;--> statement-breakpoint
ALTER TABLE "outfit_requests" ADD COLUMN "hero_noun" text;--> statement-breakpoint
ALTER TABLE "outfit_requests" ADD CONSTRAINT "outfit_requests_hero_photo_key_photos_key_fk" FOREIGN KEY ("hero_photo_key") REFERENCES "public"."photos"("key") ON DELETE set null ON UPDATE no action;