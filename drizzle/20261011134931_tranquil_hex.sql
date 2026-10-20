CREATE TABLE "order_followup" (
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"actor" text NOT NULL,
	"state" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_followup_order_id_revision_pk" PRIMARY KEY("order_id","revision"),
	CONSTRAINT "order_followup_revision_positive" CHECK ("order_followup"."revision" > 0),
	CONSTRAINT "order_followup_actor_state" CHECK (("order_followup"."actor" = 'buyer' and "order_followup"."state" in ('needs_help', 'confirmed')) or ("order_followup"."actor" = 'owner' and "order_followup"."state" = 'awaiting_customer')),
	CONSTRAINT "order_followup_message_length" CHECK (("order_followup"."state" = 'confirmed' and "order_followup"."message" = '') or ("order_followup"."state" <> 'confirmed' and length(trim("order_followup"."message")) between 3 and 1000))
);
--> statement-breakpoint
ALTER TABLE "order_followup" ADD CONSTRAINT "order_followup_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;