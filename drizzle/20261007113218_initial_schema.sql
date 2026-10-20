CREATE TABLE "access_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"capability_hash" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"last_download_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_grant_state_valid" CHECK (state in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"actor_id" text,
	"operation" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"outcome" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer_capability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_session_id" uuid NOT NULL,
	"capability_hash" text NOT NULL,
	"issued_via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buyer_handoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_session_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buyer_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"entry" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_session_entry_valid" CHECK (entry in ('page', 'widget'))
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_session_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digital_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digital_asset_size_range" CHECK ("digital_asset"."size_bytes" between 1 and 1048576),
	CONSTRAINT "digital_asset_bytes_match" CHECK (octet_length("digital_asset"."bytes") = "digital_asset"."size_bytes")
);
--> statement-breakpoint
CREATE TABLE "fixture_fault" (
	"name" text PRIMARY KEY NOT NULL,
	"remaining" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixture_provider_order" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"reference_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"payee_merchant_id" text NOT NULL,
	"capture_id" text,
	"capture_status" text,
	"capture_request_id" text,
	"capture_amount_minor" integer,
	"payer_name" text,
	"payer_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"captured_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fulfillment_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_task_type_valid" CHECK (type in ('pickup', 'service_followup', 'digital_access')),
	CONSTRAINT "fulfillment_task_state_valid" CHECK (state in ('pending', 'in_progress', 'completed', 'attention'))
);
--> statement-breakpoint
CREATE TABLE "import_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_text" text NOT NULL,
	"source_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"proposed" jsonb NOT NULL,
	"review_revision" integer DEFAULT 1 NOT NULL,
	"generator" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_draft_source_length" CHECK (char_length("import_draft"."source_text") between 1 and 20000),
	CONSTRAINT "import_draft_status_valid" CHECK (status in ('draft', 'published', 'discarded')),
	CONSTRAINT "import_draft_kind_valid" CHECK (source_kind in ('paste', 'csv'))
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_singleton_true" CHECK ("installation"."singleton"),
	CONSTRAINT "installation_environment_valid" CHECK (environment in ('fixture', 'sandbox'))
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"offer_id" uuid PRIMARY KEY NOT NULL,
	"total" integer NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_non_negative" CHECK ("inventory"."total" >= 0 and "inventory"."held" >= 0 and "inventory"."sold" >= 0),
	CONSTRAINT "inventory_not_oversold" CHECK ("inventory"."held" + "inventory"."sold" <= "inventory"."total")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_kind_valid" CHECK (kind in ('reconcile_payment', 'grant_access')),
	CONSTRAINT "job_state_valid" CHECK (state in ('pending', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_role_valid" CHECK (role in ('user', 'assistant')),
	CONSTRAINT "message_id_length" CHECK (char_length("message"."id") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"unit_amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"fulfillment_note" text DEFAULT '' NOT NULL,
	"requires_scope_review" boolean DEFAULT false NOT NULL,
	"service_scope" text,
	"digital_asset_id" uuid,
	"access_days" integer,
	"max_quantity" integer DEFAULT 10 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_kind_valid" CHECK (kind in ('goods', 'service', 'digital')),
	CONSTRAINT "offer_price_range" CHECK ("offer"."unit_amount_minor" between 1 and 10000000),
	CONSTRAINT "offer_currency_format" CHECK ("offer"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "offer_title_length" CHECK (char_length("offer"."title") between 1 and 120),
	CONSTRAINT "offer_description_length" CHECK (char_length("offer"."description") between 1 and 2000),
	CONSTRAINT "offer_max_quantity_range" CHECK ("offer"."max_quantity" between 1 and 100),
	CONSTRAINT "offer_revision_positive" CHECK ("offer"."revision" >= 1),
	CONSTRAINT "offer_digital_needs_asset" CHECK ("offer"."kind" <> 'digital' or not "offer"."published" or ("offer"."digital_asset_id" is not null and "offer"."access_days" between 1 and 3650)),
	CONSTRAINT "offer_service_needs_scope" CHECK ("offer"."kind" <> 'service' or not "offer"."published" or char_length(coalesce("offer"."service_scope", '')) > 0)
);
--> statement-breakpoint
CREATE TABLE "operation_key" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_key_scope_key_pk" PRIMARY KEY("scope","key"),
	CONSTRAINT "operation_key_state_valid" CHECK (state in ('in_progress', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"seller_id" uuid NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"buyer_session_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_capture_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"buyer_name" text,
	"buyer_email" text,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_environment_valid" CHECK (environment in ('fixture', 'sandbox')),
	CONSTRAINT "orders_total_positive" CHECK ("orders"."total_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "owner_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"verb" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_revision" integer NOT NULL,
	"args" jsonb NOT NULL,
	"args_hash" text NOT NULL,
	"summary" text NOT NULL,
	"state" text NOT NULL,
	"result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_proposal_state_valid" CHECK (state in ('pending', 'executed', 'rejected', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "payment_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"state" text NOT NULL,
	"create_request_id" uuid NOT NULL,
	"create_request_hash" text NOT NULL,
	"capture_request_id" uuid NOT NULL,
	"capture_request_hash" text,
	"provider_order_id" text,
	"provider_capture_id" text,
	"approval_url" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"payee_merchant_id" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"fence" integer DEFAULT 0 NOT NULL,
	"uncertain_since" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"check_count" integer DEFAULT 0 NOT NULL,
	"last_provider_status" text,
	"last_error" text,
	"evidence" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempt_state_valid" CHECK (state in ('planned', 'create_in_flight', 'order_created', 'approval_observed', 'capture_in_flight', 'verification_pending', 'paid', 'failed', 'cancelled')),
	CONSTRAINT "payment_attempt_environment_valid" CHECK (environment in ('fixture', 'sandbox')),
	CONSTRAINT "payment_attempt_amount_positive" CHECK ("payment_attempt"."amount_minor" > 0),
	CONSTRAINT "payment_attempt_paid_has_capture" CHECK ("payment_attempt"."state" <> 'paid' or "payment_attempt"."provider_capture_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_session_id" uuid NOT NULL,
	"status" text NOT NULL,
	"lines" jsonb NOT NULL,
	"charges" jsonb NOT NULL,
	"unresolved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"buyer_note" text,
	"budget_minor" integer,
	"delivery_requested" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"approved_scope" text,
	"seller_approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_status_valid" CHECK (status in ('needs_information', 'seller_review', 'review_ready', 'accepted', 'consumed', 'expired', 'replaced', 'cancelled')),
	CONSTRAINT "quote_totals_valid" CHECK ("quote"."subtotal_minor" >= 0 and "quote"."total_minor" >= "quote"."subtotal_minor"),
	CONSTRAINT "quote_total_cap" CHECK ("quote"."total_minor" <= 100000000),
	CONSTRAINT "quote_payable_has_total" CHECK ("quote"."status" not in ('review_ready', 'accepted', 'consumed') or "quote"."total_minor" > 0),
	CONSTRAINT "quote_note_length" CHECK (char_length(coalesce("quote"."buyer_note", '')) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_quantity_positive" CHECK ("reservation"."quantity" > 0),
	CONSTRAINT "reservation_state_valid" CHECK (state in ('held', 'captured', 'released', 'attention'))
);
--> statement-breakpoint
CREATE TABLE "seller" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"policy_revision" integer DEFAULT 1 NOT NULL,
	"pickup_policy" text,
	"service_request_policy" text,
	"digital_access_policy" text,
	"cancellation_policy" text,
	"tax_policy" text,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"buyer_turns_per_10_min" integer DEFAULT 10 NOT NULL,
	"seller_daily_ai_turns" integer DEFAULT 500 NOT NULL,
	"quote_ttl_minutes" integer DEFAULT 30 NOT NULL,
	"hold_ttl_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_singleton_true" CHECK ("seller"."singleton"),
	CONSTRAINT "seller_country_format" CHECK ("seller"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "seller_currency_format" CHECK ("seller"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "seller_buyer_turns_range" CHECK ("seller"."buyer_turns_per_10_min" between 1 and 100),
	CONSTRAINT "seller_daily_turns_range" CHECK ("seller"."seller_daily_ai_turns" between 1 and 100000),
	CONSTRAINT "seller_quote_ttl_range" CHECK ("seller"."quote_ttl_minutes" between 5 and 1440),
	CONSTRAINT "seller_hold_ttl_range" CHECK ("seller"."hold_ttl_minutes" between 5 and 120)
);
--> statement-breakpoint
CREATE TABLE "usage_bucket" (
	"feature" text NOT NULL,
	"principal" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_bucket_feature_principal_window_start_pk" PRIMARY KEY("feature","principal","window_start")
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_order_id" text,
	"summary" jsonb NOT NULL,
	"processing_state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_event_state_valid" CHECK (processing_state in ('received', 'processed', 'failed', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_asset_id_digital_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."digital_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_capability" ADD CONSTRAINT "buyer_capability_buyer_session_id_buyer_session_id_fk" FOREIGN KEY ("buyer_session_id") REFERENCES "public"."buyer_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_handoff" ADD CONSTRAINT "buyer_handoff_buyer_session_id_buyer_session_id_fk" FOREIGN KEY ("buyer_session_id") REFERENCES "public"."buyer_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_session" ADD CONSTRAINT "buyer_session_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_buyer_session_id_buyer_session_id_fk" FOREIGN KEY ("buyer_session_id") REFERENCES "public"."buyer_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset" ADD CONSTRAINT "digital_asset_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_task" ADD CONSTRAINT "fulfillment_task_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_draft" ADD CONSTRAINT "import_draft_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_digital_asset_id_digital_asset_id_fk" FOREIGN KEY ("digital_asset_id") REFERENCES "public"."digital_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_attempt_id_payment_attempt_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_session_id_buyer_session_id_fk" FOREIGN KEY ("buyer_session_id") REFERENCES "public"."buyer_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_proposal" ADD CONSTRAINT "owner_proposal_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_buyer_session_id_buyer_session_id_fk" FOREIGN KEY ("buyer_session_id") REFERENCES "public"."buyer_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller" ADD CONSTRAINT "seller_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_grant_order_asset_key" ON "access_grant" USING btree ("order_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_grant_capability_key" ON "access_grant" USING btree ("capability_hash");--> statement-breakpoint
CREATE INDEX "audit_event_target_idx" ON "audit_event" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "audit_event_created_idx" ON "audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_capability_hash_key" ON "buyer_capability" USING btree ("capability_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_handoff_code_key" ON "buyer_handoff" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_buyer_session_key" ON "conversation" USING btree ("buyer_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixture_provider_order_request_key" ON "fixture_provider_order" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_task_order_type_key" ON "fulfillment_task" USING btree ("order_id","type");--> statement-breakpoint
CREATE INDEX "fulfillment_task_state_idx" ON "fulfillment_task" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "job_kind_target_key" ON "job" USING btree ("kind","target_id");--> statement-breakpoint
CREATE INDEX "job_due_idx" ON "job" USING btree ("state","run_after");--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "offer_seller_published_idx" ON "offer" USING btree ("seller_id","published");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_key" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_payment_attempt_key" ON "orders" USING btree ("payment_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_quote_key" ON "orders" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_provider_capture_key" ON "orders" USING btree ("environment","provider_capture_id");--> statement-breakpoint
CREATE INDEX "orders_paid_at_idx" ON "orders" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "owner_proposal_state_idx" ON "owner_proposal" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_quote_key" ON "payment_attempt" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_create_request_key" ON "payment_attempt" USING btree ("create_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_capture_request_key" ON "payment_attempt" USING btree ("capture_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_provider_order_key" ON "payment_attempt" USING btree ("environment","provider_order_id") WHERE "payment_attempt"."provider_order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_provider_capture_key" ON "payment_attempt" USING btree ("environment","provider_capture_id") WHERE "payment_attempt"."provider_capture_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_attempt_due_idx" ON "payment_attempt" USING btree ("state","next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_thread_revision_key" ON "quote" USING btree ("thread_id","revision");--> statement-breakpoint
CREATE INDEX "quote_buyer_session_idx" ON "quote" USING btree ("buyer_session_id");--> statement-breakpoint
CREATE INDEX "quote_status_idx" ON "quote" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_quote_offer_key" ON "reservation" USING btree ("quote_id","offer_id");--> statement-breakpoint
CREATE INDEX "reservation_state_expiry_idx" ON "reservation" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_singleton_key" ON "seller" USING btree ("singleton");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_owner_key" ON "seller" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_provider_key" ON "webhook_event" USING btree ("environment","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_event_due_idx" ON "webhook_event" USING btree ("processing_state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");