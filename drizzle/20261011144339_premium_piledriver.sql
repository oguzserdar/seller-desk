CREATE TABLE "learning_preview" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"review_revision" integer NOT NULL,
	"finding_index" integer NOT NULL,
	"question" text NOT NULL,
	"source_hash" text NOT NULL,
	"draft_body" text NOT NULL,
	"current_facts" jsonb NOT NULL,
	"proposed_facts" jsonb NOT NULL,
	"generator" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"current_answer" jsonb,
	"proposed_answer" jsonb,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "learning_preview_state_valid" CHECK (state in ('running', 'completed', 'failed')),
	CONSTRAINT "learning_preview_revision_positive" CHECK ("learning_preview"."review_revision" > 0),
	CONSTRAINT "learning_preview_finding_range" CHECK ("learning_preview"."finding_index" between 0 and 5),
	CONSTRAINT "learning_preview_question_length" CHECK (length(trim("learning_preview"."question")) between 5 and 1000),
	CONSTRAINT "learning_preview_completed_answers" CHECK ("learning_preview"."state" <> 'completed' or ("learning_preview"."current_answer" is not null and "learning_preview"."proposed_answer" is not null))
);
--> statement-breakpoint
ALTER TABLE "learning_preview" ADD CONSTRAINT "learning_preview_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_preview" ADD CONSTRAINT "learning_preview_review_id_learning_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."learning_review"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_preview_seller_created_idx" ON "learning_preview" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_preview_one_running" ON "learning_preview" USING btree ("seller_id") WHERE "learning_preview"."state" = 'running';