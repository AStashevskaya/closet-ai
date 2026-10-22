CREATE TYPE "public"."catalog_event" AS ENUM('shown', 'opened', 'clicked');--> statement-breakpoint
CREATE TABLE "catalog_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"event" "catalog_event" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"brand" text NOT NULL,
	"names" jsonb NOT NULL,
	"category" "item_category" NOT NULL,
	"colors" "item_color"[] NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"url" text NOT NULL,
	"image_key" text NOT NULL,
	"embedding" vector(768),
	"in_stock" boolean DEFAULT true NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_events" ADD CONSTRAINT "catalog_events_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_events" ADD CONSTRAINT "catalog_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_events_item_idx" ON "catalog_events" USING btree ("catalog_item_id","event","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_external_id_idx" ON "catalog_items" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "catalog_items_embedding_idx" ON "catalog_items" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
ALTER TABLE "outfit_pieces" ADD CONSTRAINT "outfit_pieces_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;