ALTER TABLE "conversation" ADD COLUMN "handler" text DEFAULT 'assistant' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "control_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_handler_valid" CHECK (handler in ('assistant', 'seller'));--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_control_revision_positive" CHECK ("conversation"."control_revision" > 0);