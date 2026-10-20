DROP INDEX "message_conversation_idx";--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "sequence" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "message_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "message" USING btree ("conversation_id","sequence");