CREATE TABLE IF NOT EXISTS "auth_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"is_root" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_subject_check" CHECK (("is_root" AND "user_id" IS NULL) OR (NOT "is_root" AND "user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_population_progress" (
	"user_key" text NOT NULL,
	"board_id" integer NOT NULL,
	"bom_line_id" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_population_progress_pk" PRIMARY KEY("user_key","bom_line_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "board_population_progress" ADD CONSTRAINT "board_population_progress_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "board_population_progress" ADD CONSTRAINT "board_population_progress_bom_line_id_bom_lines_id_fk" FOREIGN KEY ("bom_line_id") REFERENCES "public"."bom_lines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_name_uq" ON "auth_users" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_population_user_board_idx" ON "board_population_progress" USING btree ("user_key","board_id");
