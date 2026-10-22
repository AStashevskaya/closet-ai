CREATE TYPE "public"."body_shape" AS ENUM('hourglass', 'triangle', 'inverted_triangle', 'rectangle', 'oval');--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"country" text,
	"city" text,
	"birth_year" integer,
	"height_cm" integer,
	"body_shape" "body_shape",
	"size_top" text,
	"size_bottom" text,
	"size_shoes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;