CREATE TABLE "want_more_taps" (
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"taps" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "want_more_taps_user_id_code_pk" PRIMARY KEY("user_id","code")
);
--> statement-breakpoint
ALTER TABLE "want_more_taps" ADD CONSTRAINT "want_more_taps_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;