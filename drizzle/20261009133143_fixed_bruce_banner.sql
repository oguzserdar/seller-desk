CREATE TABLE "shop_guide" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"title" text NOT NULL,
	"topic" text NOT NULL,
	"body" text NOT NULL,
	"action_label" text,
	"action_url" text,
	"published" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_guide_revision_positive" CHECK ("shop_guide"."revision" > 0),
	CONSTRAINT "shop_guide_title_length" CHECK (length("shop_guide"."title") between 3 and 100),
	CONSTRAINT "shop_guide_body_length" CHECK (length("shop_guide"."body") between 10 and 2000),
	CONSTRAINT "shop_guide_topic_valid" CHECK (topic in ('shipping', 'returns', 'options', 'booking', 'subscriptions', 'downloads', 'general')),
	CONSTRAINT "shop_guide_action_pair" CHECK (("shop_guide"."action_label" is null and "shop_guide"."action_url" is null) or ("shop_guide"."action_label" is not null and "shop_guide"."action_url" is not null and length("shop_guide"."action_label") between 1 and 60 and length("shop_guide"."action_url") between 1 and 1500 and "shop_guide"."action_url" like 'https://%'))
);
--> statement-breakpoint
ALTER TABLE "shop_guide" ADD CONSTRAINT "shop_guide_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_guide_seller_idx" ON "shop_guide" USING btree ("seller_id");