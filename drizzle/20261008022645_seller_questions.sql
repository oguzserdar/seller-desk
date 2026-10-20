CREATE TABLE "seller_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"buyer_session_id" uuid NOT NULL,
	"question" text NOT NULL,
	"customer_goal" text NOT NULL,
	"known_facts" jsonb NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"resumed_at" timestamp with time zone,
	"resume_attempts" integer DEFAULT 0 NOT NULL,
	"resume_error" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_question_state_valid" CHECK (state in ('open', 'answered', 'resumed', 'closed')),
	CONSTRAINT "seller_question_lengths" CHECK (char_length("seller_question"."question") between 1 and 500 and char_length("seller_question"."customer_goal") between 1 and 500 and ("seller_question"."answer" is null or char_length("seller_question"."answer") between 1 and 1000))
);
--> statement-breakpoint
ALTER TABLE "installation" ADD COLUMN "ai_check_model" text;--> statement-breakpoint
ALTER TABLE "installation" ADD COLUMN "ai_check_ok" boolean;--> statement-breakpoint
ALTER TABLE "installation" ADD COLUMN "ai_check_detail" text;--> statement-breakpoint
ALTER TABLE "installation" ADD COLUMN "ai_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_question" ADD CONSTRAINT "seller_question_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_question" ADD CONSTRAINT "seller_question_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_question" ADD CONSTRAINT "seller_question_buyer_session_id_buyer_session_id_fk" FOREIGN KEY ("buyer_session_id") REFERENCES "public"."buyer_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_question_one_waiting_per_conversation" ON "seller_question" USING btree ("conversation_id") WHERE "seller_question"."state" in ('open', 'answered');--> statement-breakpoint
CREATE INDEX "seller_question_seller_state_idx" ON "seller_question" USING btree ("seller_id","state");