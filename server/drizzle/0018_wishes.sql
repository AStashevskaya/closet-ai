CREATE TABLE "wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"ask_at" timestamp with time zone NOT NULL,
	"still_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_request_id_outfit_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."outfit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wishes_request_idx" ON "wishes" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "wishes_user_idx" ON "wishes" USING btree ("user_id");