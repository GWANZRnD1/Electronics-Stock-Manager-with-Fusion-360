ALTER TABLE "parts" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "package" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "parts_category_idx" ON "parts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "parts_package_idx" ON "parts" USING btree ("package");