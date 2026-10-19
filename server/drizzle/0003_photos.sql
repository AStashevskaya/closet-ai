CREATE TYPE "public"."photo_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "photos" (
	"key" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"upload_key" text,
	"status" "photo_status" DEFAULT 'processing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_owner_id_idx" ON "photos" USING btree ("owner_id");--> statement-breakpoint
-- Photos uploaded before this table existed were processed synchronously, so they are ready.
INSERT INTO "photos" ("key", "owner_id", "status", "created_at")
SELECT DISTINCT ON ("photo_key") "photo_key", "owner_id", 'ready', "created_at"
FROM "items" WHERE "photo_key" IS NOT NULL
ORDER BY "photo_key", "created_at";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_photo_key_photos_key_fk" FOREIGN KEY ("photo_key") REFERENCES "public"."photos"("key") ON DELETE set null ON UPDATE no action;