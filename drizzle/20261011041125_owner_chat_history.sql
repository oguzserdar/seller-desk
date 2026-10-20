CREATE TABLE "owner_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"active_turn_id" uuid,
	"active_turn_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_message" (
	"id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" integer GENERATED ALWAYS AS IDENTITY (sequence name "owner_message_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_message_conversation_id_id_pk" PRIMARY KEY("conversation_id","id"),
	CONSTRAINT "owner_message_role_valid" CHECK (role in ('user', 'assistant')),
	CONSTRAINT "owner_message_id_length" CHECK (char_length("owner_message"."id") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "owner_conversation" ADD CONSTRAINT "owner_conversation_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_conversation" ADD CONSTRAINT "owner_conversation_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_message" ADD CONSTRAINT "owner_message_conversation_id_owner_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."owner_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_conversation_scope_key" ON "owner_conversation" USING btree ("seller_id","owner_id");--> statement-breakpoint
CREATE INDEX "owner_message_history_idx" ON "owner_message" USING btree ("conversation_id","sequence");