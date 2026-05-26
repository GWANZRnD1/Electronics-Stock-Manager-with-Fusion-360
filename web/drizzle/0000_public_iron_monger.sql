CREATE TABLE "boards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fusion_doc_id" text,
	"revision" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"board_id" integer NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"package" text DEFAULT '' NOT NULL,
	"designators" text DEFAULT '' NOT NULL,
	"qty_per_board" integer DEFAULT 1 NOT NULL,
	"part_mpn" text,
	"matched_part_id" integer
);
--> statement-breakpoint
CREATE TABLE "build_consumptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"build_id" integer NOT NULL,
	"part_id" integer NOT NULL,
	"location_id" integer,
	"quantity" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"id" serial PRIMARY KEY NOT NULL,
	"board_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"actor" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_txns" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"location_id" integer,
	"delta" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"actor" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"mpn" text NOT NULL,
	"manufacturer" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_matched_part_id_parts_id_fk" FOREIGN KEY ("matched_part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_consumptions" ADD CONSTRAINT "build_consumptions_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_consumptions" ADD CONSTRAINT "build_consumptions_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_consumptions" ADD CONSTRAINT "build_consumptions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_txns" ADD CONSTRAINT "inventory_txns_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_txns" ADD CONSTRAINT "inventory_txns_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boards_fusion_doc_idx" ON "boards" USING btree ("fusion_doc_id");--> statement-breakpoint
CREATE INDEX "bom_board_idx" ON "bom_lines" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "bom_mpn_idx" ON "bom_lines" USING btree ("part_mpn");--> statement-breakpoint
CREATE INDEX "bc_build_idx" ON "build_consumptions" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "builds_board_idx" ON "builds" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "txn_part_idx" ON "inventory_txns" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "txn_created_idx" ON "inventory_txns" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_name_uq" ON "locations" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "parts_mpn_uq" ON "parts" USING btree ("mpn");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_part_location_uq" ON "stock_items" USING btree ("part_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_part_idx" ON "stock_items" USING btree ("part_id");