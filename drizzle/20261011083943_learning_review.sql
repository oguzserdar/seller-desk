CREATE TABLE "learning_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"source_hash" text NOT NULL,
	"source" jsonb NOT NULL,
	"analysis" jsonb NOT NULL,
	"generator" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_review_state_valid" CHECK (state in ('draft', 'deferred', 'rejected')),
	CONSTRAINT "learning_review_revision_positive" CHECK ("learning_review"."revision" > 0),
	CONSTRAINT "learning_review_source_hash_length" CHECK (length("learning_review"."source_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "learning_review" ADD CONSTRAINT "learning_review_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_review" ADD CONSTRAINT "learning_review_question_id_seller_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."seller_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_review_source_unique" ON "learning_review" USING btree ("seller_id","question_id","source_hash");--> statement-breakpoint
CREATE INDEX "learning_review_seller_state_idx" ON "learning_review" USING btree ("seller_id","state");