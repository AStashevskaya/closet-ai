CREATE TYPE "public"."outfit_reaction" AS ENUM('like', 'dislike', 'none', 'wore');--> statement-breakpoint
CREATE TYPE "public"."outfit_request_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
ALTER TYPE "public"."usage_action" ADD VALUE 'wear_with';--> statement-breakpoint
CREATE TABLE "outfit_pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outfit_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"hero" boolean DEFAULT false NOT NULL,
	"item_id" uuid,
	"catalog_item_id" uuid,
	"sponsored" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outfit_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outfit_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reaction" "outfit_reaction" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outfit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"item_id" uuid,
	"status" "outfit_request_status" DEFAULT 'pending' NOT NULL,
	"wardrobe_size" integer NOT NULL,
	"cost_micros" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outfits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"caption" text NOT NULL,
	"occasion" text NOT NULL,
	"why" text NOT NULL,
	"missing" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_briefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"brief" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"written_at" timestamp with time zone,
	"batch_id" text,
	"requested_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "outfit_pieces" ADD CONSTRAINT "outfit_pieces_outfit_id_outfits_id_fk" FOREIGN KEY ("outfit_id") REFERENCES "public"."outfits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfit_pieces" ADD CONSTRAINT "outfit_pieces_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfit_reactions" ADD CONSTRAINT "outfit_reactions_outfit_id_outfits_id_fk" FOREIGN KEY ("outfit_id") REFERENCES "public"."outfits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfit_reactions" ADD CONSTRAINT "outfit_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfit_requests" ADD CONSTRAINT "outfit_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfit_requests" ADD CONSTRAINT "outfit_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_request_id_outfit_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."outfit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_briefs" ADD CONSTRAINT "style_briefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outfit_pieces_outfit_idx" ON "outfit_pieces" USING btree ("outfit_id");--> statement-breakpoint
CREATE INDEX "outfit_reactions_outfit_idx" ON "outfit_reactions" USING btree ("outfit_id");--> statement-breakpoint
CREATE INDEX "outfit_requests_user_item_idx" ON "outfit_requests" USING btree ("user_id","item_id");--> statement-breakpoint
CREATE INDEX "outfits_request_idx" ON "outfits" USING btree ("request_id");