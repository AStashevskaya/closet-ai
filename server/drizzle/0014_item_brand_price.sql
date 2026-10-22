CREATE TYPE "public"."currency" AS ENUM('ILS', 'USD', 'EUR', 'GBP', 'RUB', 'UAH', 'BYN');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "price_minor" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "currency" "currency";--> statement-breakpoint
-- Items saved before this get the brand the vision model read off their photo, when it saw one.
UPDATE "items" SET "brand" = "photos"."tags"->>'brand'
FROM "photos"
WHERE "photos"."key" = "items"."photo_key"
  AND "items"."brand" IS NULL
  AND nullif(trim("photos"."tags"->>'brand'), '') IS NOT NULL;
