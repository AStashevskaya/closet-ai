CREATE TYPE "public"."usage_action" AS ENUM('item_photo', 'want', 'look');--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"action" "usage_action" NOT NULL,
	"cost_micros" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_events_user_action_idx" ON "usage_events" USING btree ("user_id","action","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_created_at_idx" ON "usage_events" USING btree ("created_at");