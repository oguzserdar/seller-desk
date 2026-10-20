CREATE TABLE "learning_publication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"finding_index" integer NOT NULL,
	"guide_id" uuid NOT NULL,
	"guide_revision" integer NOT NULL,
	"approved_input" jsonb NOT NULL,
	"public_source" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_publication_finding_range" CHECK ("learning_publication"."finding_index" between 0 and 5),
	CONSTRAINT "learning_publication_revision_positive" CHECK ("learning_publication"."guide_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "learning_publication" ADD CONSTRAINT "learning_publication_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_publication" ADD CONSTRAINT "learning_publication_review_id_learning_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."learning_review"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_publication" ADD CONSTRAINT "learning_publication_guide_id_shop_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."shop_guide"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_publication_finding_unique" ON "learning_publication" USING btree ("review_id","finding_index");--> statement-breakpoint
CREATE INDEX "learning_publication_seller_idx" ON "learning_publication" USING btree ("seller_id");