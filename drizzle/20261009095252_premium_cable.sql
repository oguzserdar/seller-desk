ALTER TABLE "conversation" ADD COLUMN "active_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "active_turn_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seller_question" ADD COLUMN "resume_after" timestamp with time zone DEFAULT now() NOT NULL;