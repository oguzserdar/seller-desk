CREATE TABLE "procedure_preview" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"published_revision" integer,
	"question" text NOT NULL,
	"wording" jsonb NOT NULL,
	"facts" jsonb NOT NULL,
	"current_instructions" jsonb NOT NULL,
	"proposed_instructions" jsonb NOT NULL,
	"generator" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"current_answer" jsonb,
	"proposed_answer" jsonb,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "procedure_preview_state_valid" CHECK (state in ('running', 'completed', 'failed')),
	CONSTRAINT "procedure_preview_revision_positive" CHECK ("procedure_preview"."revision" > 0),
	CONSTRAINT "procedure_preview_question_length" CHECK (length(trim("procedure_preview"."question")) between 5 and 1000),
	CONSTRAINT "procedure_preview_completed_answers" CHECK ("procedure_preview"."state" <> 'completed' or ("procedure_preview"."current_answer" is not null and "procedure_preview"."proposed_answer" is not null))
);
--> statement-breakpoint
ALTER TABLE "procedure_preview" ADD CONSTRAINT "procedure_preview_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_preview" ADD CONSTRAINT "procedure_preview_procedure_id_assistant_procedure_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."assistant_procedure"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_preview_seller_created_idx" ON "procedure_preview" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_preview_one_running" ON "procedure_preview" USING btree ("seller_id") WHERE "procedure_preview"."state" = 'running';