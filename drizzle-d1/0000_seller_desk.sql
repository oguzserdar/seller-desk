CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `digital_asset` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "digital_asset_id_storage" CHECK("digital_asset"."id" is null or (typeof("digital_asset"."id") = 'text' and length("digital_asset"."id") = 36 and substr("digital_asset"."id",9,1) = '-' and substr("digital_asset"."id",14,1) = '-' and substr("digital_asset"."id",19,1) = '-' and substr("digital_asset"."id",24,1) = '-' and length(replace("digital_asset"."id",'-','')) = 32 and replace("digital_asset"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "digital_asset_seller_id_storage" CHECK("digital_asset"."seller_id" is null or (typeof("digital_asset"."seller_id") = 'text' and length("digital_asset"."seller_id") = 36 and substr("digital_asset"."seller_id",9,1) = '-' and substr("digital_asset"."seller_id",14,1) = '-' and substr("digital_asset"."seller_id",19,1) = '-' and substr("digital_asset"."seller_id",24,1) = '-' and length(replace("digital_asset"."seller_id",'-','')) = 32 and replace("digital_asset"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "digital_asset_size_bytes_storage" CHECK("digital_asset"."size_bytes" is null or (typeof("digital_asset"."size_bytes") = 'integer' and "digital_asset"."size_bytes" between -2147483648 and 2147483647)),
	CONSTRAINT "digital_asset_bytes_storage" CHECK("digital_asset"."bytes" is null or typeof("digital_asset"."bytes") = 'blob'),
	CONSTRAINT "digital_asset_created_at_storage" CHECK("digital_asset"."created_at" is null or (typeof("digital_asset"."created_at") = 'integer' and "digital_asset"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "digital_asset_size_range" CHECK("digital_asset"."size_bytes" between 1 and 1048576),
	CONSTRAINT "digital_asset_bytes_match" CHECK(length("digital_asset"."bytes") = "digital_asset"."size_bytes")
);
--> statement-breakpoint
CREATE TABLE `installation` (
	`singleton` integer PRIMARY KEY DEFAULT true NOT NULL,
	`environment` text NOT NULL,
	`ai_check_model` text,
	`ai_check_ok` integer,
	`ai_check_detail` text,
	`ai_checked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "installation_singleton_storage" CHECK("installation"."singleton" is null or (typeof("installation"."singleton") = 'integer' and "installation"."singleton" in (0, 1))),
	CONSTRAINT "installation_ai_check_ok_storage" CHECK("installation"."ai_check_ok" is null or (typeof("installation"."ai_check_ok") = 'integer' and "installation"."ai_check_ok" in (0, 1))),
	CONSTRAINT "installation_ai_checked_at_storage" CHECK("installation"."ai_checked_at" is null or (typeof("installation"."ai_checked_at") = 'integer' and "installation"."ai_checked_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "installation_created_at_storage" CHECK("installation"."created_at" is null or (typeof("installation"."created_at") = 'integer' and "installation"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "installation_singleton_true" CHECK("installation"."singleton"),
	CONSTRAINT "installation_environment_valid" CHECK(environment in ('fixture', 'sandbox'))
);
--> statement-breakpoint
CREATE TABLE `seller` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`singleton` integer DEFAULT true NOT NULL,
	`owner_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`country` text NOT NULL,
	`currency` text NOT NULL,
	`policy_revision` integer DEFAULT 1 NOT NULL,
	`pickup_policy` text,
	`service_request_policy` text,
	`digital_access_policy` text,
	`cancellation_policy` text,
	`tax_policy` text,
	`allowed_origins` text DEFAULT '[]' NOT NULL,
	`buyer_turns_per_10_min` integer DEFAULT 10 NOT NULL,
	`seller_daily_ai_turns` integer DEFAULT 500 NOT NULL,
	`quote_ttl_minutes` integer DEFAULT 30 NOT NULL,
	`hold_ttl_minutes` integer DEFAULT 15 NOT NULL,
	`theme` text DEFAULT 'slate' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "seller_id_storage" CHECK("seller"."id" is null or (typeof("seller"."id") = 'text' and length("seller"."id") = 36 and substr("seller"."id",9,1) = '-' and substr("seller"."id",14,1) = '-' and substr("seller"."id",19,1) = '-' and substr("seller"."id",24,1) = '-' and length(replace("seller"."id",'-','')) = 32 and replace("seller"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "seller_singleton_storage" CHECK("seller"."singleton" is null or (typeof("seller"."singleton") = 'integer' and "seller"."singleton" in (0, 1))),
	CONSTRAINT "seller_owner_user_id_storage" CHECK("seller"."owner_user_id" is null or (typeof("seller"."owner_user_id") = 'text' and length("seller"."owner_user_id") = 36 and substr("seller"."owner_user_id",9,1) = '-' and substr("seller"."owner_user_id",14,1) = '-' and substr("seller"."owner_user_id",19,1) = '-' and substr("seller"."owner_user_id",24,1) = '-' and length(replace("seller"."owner_user_id",'-','')) = 32 and replace("seller"."owner_user_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "seller_policy_revision_storage" CHECK("seller"."policy_revision" is null or (typeof("seller"."policy_revision") = 'integer' and "seller"."policy_revision" between -2147483648 and 2147483647)),
	CONSTRAINT "seller_allowed_origins_storage" CHECK("seller"."allowed_origins" is null or (typeof("seller"."allowed_origins") = 'text' and json_valid("seller"."allowed_origins"))),
	CONSTRAINT "seller_buyer_turns_per_10_min_storage" CHECK("seller"."buyer_turns_per_10_min" is null or (typeof("seller"."buyer_turns_per_10_min") = 'integer' and "seller"."buyer_turns_per_10_min" between -2147483648 and 2147483647)),
	CONSTRAINT "seller_seller_daily_ai_turns_storage" CHECK("seller"."seller_daily_ai_turns" is null or (typeof("seller"."seller_daily_ai_turns") = 'integer' and "seller"."seller_daily_ai_turns" between -2147483648 and 2147483647)),
	CONSTRAINT "seller_quote_ttl_minutes_storage" CHECK("seller"."quote_ttl_minutes" is null or (typeof("seller"."quote_ttl_minutes") = 'integer' and "seller"."quote_ttl_minutes" between -2147483648 and 2147483647)),
	CONSTRAINT "seller_hold_ttl_minutes_storage" CHECK("seller"."hold_ttl_minutes" is null or (typeof("seller"."hold_ttl_minutes") = 'integer' and "seller"."hold_ttl_minutes" between -2147483648 and 2147483647)),
	CONSTRAINT "seller_created_at_storage" CHECK("seller"."created_at" is null or (typeof("seller"."created_at") = 'integer' and "seller"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "seller_updated_at_storage" CHECK("seller"."updated_at" is null or (typeof("seller"."updated_at") = 'integer' and "seller"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "seller_singleton_true" CHECK("seller"."singleton"),
	CONSTRAINT "seller_country_format" CHECK(length("seller"."country") = 2 and "seller"."country" not glob '*[^A-Z]*'),
	CONSTRAINT "seller_currency_format" CHECK(length("seller"."currency") = 3 and "seller"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "seller_buyer_turns_range" CHECK("seller"."buyer_turns_per_10_min" between 1 and 100),
	CONSTRAINT "seller_daily_turns_range" CHECK("seller"."seller_daily_ai_turns" between 1 and 100000),
	CONSTRAINT "seller_quote_ttl_range" CHECK("seller"."quote_ttl_minutes" between 5 and 1440),
	CONSTRAINT "seller_hold_ttl_range" CHECK("seller"."hold_ttl_minutes" between 5 and 120),
	CONSTRAINT "seller_theme_known" CHECK("seller"."theme" in ('slate', 'spruce', 'brick', 'ink', 'plum'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_singleton_key` ON `seller` (`singleton`);--> statement-breakpoint
CREATE UNIQUE INDEX `seller_owner_key` ON `seller` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `import_draft` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_text` text NOT NULL,
	`source_hash` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`proposed` text NOT NULL,
	`review_revision` integer DEFAULT 1 NOT NULL,
	`generator` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "import_draft_id_storage" CHECK("import_draft"."id" is null or (typeof("import_draft"."id") = 'text' and length("import_draft"."id") = 36 and substr("import_draft"."id",9,1) = '-' and substr("import_draft"."id",14,1) = '-' and substr("import_draft"."id",19,1) = '-' and substr("import_draft"."id",24,1) = '-' and length(replace("import_draft"."id",'-','')) = 32 and replace("import_draft"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "import_draft_seller_id_storage" CHECK("import_draft"."seller_id" is null or (typeof("import_draft"."seller_id") = 'text' and length("import_draft"."seller_id") = 36 and substr("import_draft"."seller_id",9,1) = '-' and substr("import_draft"."seller_id",14,1) = '-' and substr("import_draft"."seller_id",19,1) = '-' and substr("import_draft"."seller_id",24,1) = '-' and length(replace("import_draft"."seller_id",'-','')) = 32 and replace("import_draft"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "import_draft_proposed_storage" CHECK("import_draft"."proposed" is null or (typeof("import_draft"."proposed") = 'text' and json_valid("import_draft"."proposed"))),
	CONSTRAINT "import_draft_review_revision_storage" CHECK("import_draft"."review_revision" is null or (typeof("import_draft"."review_revision") = 'integer' and "import_draft"."review_revision" between -2147483648 and 2147483647)),
	CONSTRAINT "import_draft_created_at_storage" CHECK("import_draft"."created_at" is null or (typeof("import_draft"."created_at") = 'integer' and "import_draft"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "import_draft_updated_at_storage" CHECK("import_draft"."updated_at" is null or (typeof("import_draft"."updated_at") = 'integer' and "import_draft"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "import_draft_source_length" CHECK(length("import_draft"."source_text") between 1 and 20000),
	CONSTRAINT "import_draft_status_valid" CHECK(status in ('draft', 'published', 'discarded')),
	CONSTRAINT "import_draft_kind_valid" CHECK(source_kind in ('paste', 'csv'))
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`offer_id` text PRIMARY KEY NOT NULL,
	`total` integer NOT NULL,
	`held` integer DEFAULT 0 NOT NULL,
	`sold` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inventory_offer_id_storage" CHECK("inventory"."offer_id" is null or (typeof("inventory"."offer_id") = 'text' and length("inventory"."offer_id") = 36 and substr("inventory"."offer_id",9,1) = '-' and substr("inventory"."offer_id",14,1) = '-' and substr("inventory"."offer_id",19,1) = '-' and substr("inventory"."offer_id",24,1) = '-' and length(replace("inventory"."offer_id",'-','')) = 32 and replace("inventory"."offer_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "inventory_total_storage" CHECK("inventory"."total" is null or (typeof("inventory"."total") = 'integer' and "inventory"."total" between -2147483648 and 2147483647)),
	CONSTRAINT "inventory_held_storage" CHECK("inventory"."held" is null or (typeof("inventory"."held") = 'integer' and "inventory"."held" between -2147483648 and 2147483647)),
	CONSTRAINT "inventory_sold_storage" CHECK("inventory"."sold" is null or (typeof("inventory"."sold") = 'integer' and "inventory"."sold" between -2147483648 and 2147483647)),
	CONSTRAINT "inventory_updated_at_storage" CHECK("inventory"."updated_at" is null or (typeof("inventory"."updated_at") = 'integer' and "inventory"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "inventory_non_negative" CHECK("inventory"."total" >= 0 and "inventory"."held" >= 0 and "inventory"."sold" >= 0),
	CONSTRAINT "inventory_not_oversold" CHECK("inventory"."held" + "inventory"."sold" <= "inventory"."total")
);
--> statement-breakpoint
CREATE TABLE `offer` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`unit_amount_minor` integer,
	`currency` text NOT NULL,
	`fulfillment_note` text DEFAULT '' NOT NULL,
	`requires_scope_review` integer DEFAULT false NOT NULL,
	`service_scope` text,
	`digital_asset_id` text,
	`access_days` integer,
	`max_quantity` integer DEFAULT 10 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`image_path` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`digital_asset_id`) REFERENCES `digital_asset`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "offer_id_storage" CHECK("offer"."id" is null or (typeof("offer"."id") = 'text' and length("offer"."id") = 36 and substr("offer"."id",9,1) = '-' and substr("offer"."id",14,1) = '-' and substr("offer"."id",19,1) = '-' and substr("offer"."id",24,1) = '-' and length(replace("offer"."id",'-','')) = 32 and replace("offer"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "offer_seller_id_storage" CHECK("offer"."seller_id" is null or (typeof("offer"."seller_id") = 'text' and length("offer"."seller_id") = 36 and substr("offer"."seller_id",9,1) = '-' and substr("offer"."seller_id",14,1) = '-' and substr("offer"."seller_id",19,1) = '-' and substr("offer"."seller_id",24,1) = '-' and length(replace("offer"."seller_id",'-','')) = 32 and replace("offer"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "offer_revision_storage" CHECK("offer"."revision" is null or (typeof("offer"."revision") = 'integer' and "offer"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "offer_published_storage" CHECK("offer"."published" is null or (typeof("offer"."published") = 'integer' and "offer"."published" in (0, 1))),
	CONSTRAINT "offer_unit_amount_minor_storage" CHECK("offer"."unit_amount_minor" is null or (typeof("offer"."unit_amount_minor") = 'integer' and "offer"."unit_amount_minor" between -2147483648 and 2147483647)),
	CONSTRAINT "offer_requires_scope_review_storage" CHECK("offer"."requires_scope_review" is null or (typeof("offer"."requires_scope_review") = 'integer' and "offer"."requires_scope_review" in (0, 1))),
	CONSTRAINT "offer_digital_asset_id_storage" CHECK("offer"."digital_asset_id" is null or (typeof("offer"."digital_asset_id") = 'text' and length("offer"."digital_asset_id") = 36 and substr("offer"."digital_asset_id",9,1) = '-' and substr("offer"."digital_asset_id",14,1) = '-' and substr("offer"."digital_asset_id",19,1) = '-' and substr("offer"."digital_asset_id",24,1) = '-' and length(replace("offer"."digital_asset_id",'-','')) = 32 and replace("offer"."digital_asset_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "offer_access_days_storage" CHECK("offer"."access_days" is null or (typeof("offer"."access_days") = 'integer' and "offer"."access_days" between -2147483648 and 2147483647)),
	CONSTRAINT "offer_max_quantity_storage" CHECK("offer"."max_quantity" is null or (typeof("offer"."max_quantity") = 'integer' and "offer"."max_quantity" between -2147483648 and 2147483647)),
	CONSTRAINT "offer_sort_order_storage" CHECK("offer"."sort_order" is null or (typeof("offer"."sort_order") = 'integer' and "offer"."sort_order" between -2147483648 and 2147483647)),
	CONSTRAINT "offer_created_at_storage" CHECK("offer"."created_at" is null or (typeof("offer"."created_at") = 'integer' and "offer"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "offer_updated_at_storage" CHECK("offer"."updated_at" is null or (typeof("offer"."updated_at") = 'integer' and "offer"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "offer_image_path_local" CHECK("offer"."image_path" is null or ("offer"."image_path" glob '/shop/*' and (substr("offer"."image_path", -5) = '.webp' or substr("offer"."image_path", -4) in ('.png', '.jpg')) and length(substr("offer"."image_path", 7, length("offer"."image_path") - 6 - case when substr("offer"."image_path", -5) = '.webp' then 5 else 4 end)) between 1 and 60 and substr("offer"."image_path", 7, length("offer"."image_path") - 6 - case when substr("offer"."image_path", -5) = '.webp' then 5 else 4 end) not glob '*[^a-z0-9-]*')),
	CONSTRAINT "offer_kind_valid" CHECK(kind in ('goods', 'service', 'digital')),
	CONSTRAINT "offer_price_range" CHECK(("offer"."unit_amount_minor" is not null and "offer"."unit_amount_minor" between 1 and 10000000) or ("offer"."unit_amount_minor" is null and "offer"."kind" = 'service' and "offer"."requires_scope_review")),
	CONSTRAINT "offer_currency_format" CHECK(length("offer"."currency") = 3 and "offer"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "offer_title_length" CHECK(length("offer"."title") between 1 and 120),
	CONSTRAINT "offer_description_length" CHECK(length("offer"."description") between 1 and 2000),
	CONSTRAINT "offer_max_quantity_range" CHECK("offer"."max_quantity" between 1 and 100),
	CONSTRAINT "offer_revision_positive" CHECK("offer"."revision" >= 1),
	CONSTRAINT "offer_digital_needs_asset" CHECK("offer"."kind" <> 'digital' or not "offer"."published" or ("offer"."digital_asset_id" is not null and "offer"."access_days" between 1 and 3650)),
	CONSTRAINT "offer_service_needs_scope" CHECK("offer"."kind" <> 'service' or not "offer"."published" or length(coalesce("offer"."service_scope", '')) > 0)
);
--> statement-breakpoint
CREATE INDEX `offer_seller_published_idx` ON `offer` (`seller_id`,`published`);--> statement-breakpoint
CREATE TABLE `buyer_capability` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`buyer_session_id` text NOT NULL,
	`capability_hash` text NOT NULL,
	`issued_via` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`buyer_session_id`) REFERENCES `buyer_session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "buyer_capability_id_storage" CHECK("buyer_capability"."id" is null or (typeof("buyer_capability"."id") = 'text' and length("buyer_capability"."id") = 36 and substr("buyer_capability"."id",9,1) = '-' and substr("buyer_capability"."id",14,1) = '-' and substr("buyer_capability"."id",19,1) = '-' and substr("buyer_capability"."id",24,1) = '-' and length(replace("buyer_capability"."id",'-','')) = 32 and replace("buyer_capability"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "buyer_capability_buyer_session_id_storage" CHECK("buyer_capability"."buyer_session_id" is null or (typeof("buyer_capability"."buyer_session_id") = 'text' and length("buyer_capability"."buyer_session_id") = 36 and substr("buyer_capability"."buyer_session_id",9,1) = '-' and substr("buyer_capability"."buyer_session_id",14,1) = '-' and substr("buyer_capability"."buyer_session_id",19,1) = '-' and substr("buyer_capability"."buyer_session_id",24,1) = '-' and length(replace("buyer_capability"."buyer_session_id",'-','')) = 32 and replace("buyer_capability"."buyer_session_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "buyer_capability_created_at_storage" CHECK("buyer_capability"."created_at" is null or (typeof("buyer_capability"."created_at") = 'integer' and "buyer_capability"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "buyer_capability_expires_at_storage" CHECK("buyer_capability"."expires_at" is null or (typeof("buyer_capability"."expires_at") = 'integer' and "buyer_capability"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "buyer_capability_revoked_at_storage" CHECK("buyer_capability"."revoked_at" is null or (typeof("buyer_capability"."revoked_at") = 'integer' and "buyer_capability"."revoked_at" between -8640000000000000 and 8640000000000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buyer_capability_hash_key` ON `buyer_capability` (`capability_hash`);--> statement-breakpoint
CREATE TABLE `buyer_handoff` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`buyer_session_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`quote_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`buyer_session_id`) REFERENCES `buyer_session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "buyer_handoff_id_storage" CHECK("buyer_handoff"."id" is null or (typeof("buyer_handoff"."id") = 'text' and length("buyer_handoff"."id") = 36 and substr("buyer_handoff"."id",9,1) = '-' and substr("buyer_handoff"."id",14,1) = '-' and substr("buyer_handoff"."id",19,1) = '-' and substr("buyer_handoff"."id",24,1) = '-' and length(replace("buyer_handoff"."id",'-','')) = 32 and replace("buyer_handoff"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "buyer_handoff_buyer_session_id_storage" CHECK("buyer_handoff"."buyer_session_id" is null or (typeof("buyer_handoff"."buyer_session_id") = 'text' and length("buyer_handoff"."buyer_session_id") = 36 and substr("buyer_handoff"."buyer_session_id",9,1) = '-' and substr("buyer_handoff"."buyer_session_id",14,1) = '-' and substr("buyer_handoff"."buyer_session_id",19,1) = '-' and substr("buyer_handoff"."buyer_session_id",24,1) = '-' and length(replace("buyer_handoff"."buyer_session_id",'-','')) = 32 and replace("buyer_handoff"."buyer_session_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "buyer_handoff_quote_id_storage" CHECK("buyer_handoff"."quote_id" is null or (typeof("buyer_handoff"."quote_id") = 'text' and length("buyer_handoff"."quote_id") = 36 and substr("buyer_handoff"."quote_id",9,1) = '-' and substr("buyer_handoff"."quote_id",14,1) = '-' and substr("buyer_handoff"."quote_id",19,1) = '-' and substr("buyer_handoff"."quote_id",24,1) = '-' and length(replace("buyer_handoff"."quote_id",'-','')) = 32 and replace("buyer_handoff"."quote_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "buyer_handoff_created_at_storage" CHECK("buyer_handoff"."created_at" is null or (typeof("buyer_handoff"."created_at") = 'integer' and "buyer_handoff"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "buyer_handoff_expires_at_storage" CHECK("buyer_handoff"."expires_at" is null or (typeof("buyer_handoff"."expires_at") = 'integer' and "buyer_handoff"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "buyer_handoff_used_at_storage" CHECK("buyer_handoff"."used_at" is null or (typeof("buyer_handoff"."used_at") = 'integer' and "buyer_handoff"."used_at" between -8640000000000000 and 8640000000000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buyer_handoff_code_key` ON `buyer_handoff` (`code_hash`);--> statement-breakpoint
CREATE TABLE `buyer_session` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`entry` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "buyer_session_id_storage" CHECK("buyer_session"."id" is null or (typeof("buyer_session"."id") = 'text' and length("buyer_session"."id") = 36 and substr("buyer_session"."id",9,1) = '-' and substr("buyer_session"."id",14,1) = '-' and substr("buyer_session"."id",19,1) = '-' and substr("buyer_session"."id",24,1) = '-' and length(replace("buyer_session"."id",'-','')) = 32 and replace("buyer_session"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "buyer_session_seller_id_storage" CHECK("buyer_session"."seller_id" is null or (typeof("buyer_session"."seller_id") = 'text' and length("buyer_session"."seller_id") = 36 and substr("buyer_session"."seller_id",9,1) = '-' and substr("buyer_session"."seller_id",14,1) = '-' and substr("buyer_session"."seller_id",19,1) = '-' and substr("buyer_session"."seller_id",24,1) = '-' and length(replace("buyer_session"."seller_id",'-','')) = 32 and replace("buyer_session"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "buyer_session_created_at_storage" CHECK("buyer_session"."created_at" is null or (typeof("buyer_session"."created_at") = 'integer' and "buyer_session"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "buyer_session_expires_at_storage" CHECK("buyer_session"."expires_at" is null or (typeof("buyer_session"."expires_at") = 'integer' and "buyer_session"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "buyer_session_revoked_at_storage" CHECK("buyer_session"."revoked_at" is null or (typeof("buyer_session"."revoked_at") = 'integer' and "buyer_session"."revoked_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "buyer_session_last_seen_at_storage" CHECK("buyer_session"."last_seen_at" is null or (typeof("buyer_session"."last_seen_at") = 'integer' and "buyer_session"."last_seen_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "buyer_session_entry_valid" CHECK(entry in ('page', 'widget'))
);
--> statement-breakpoint
CREATE TABLE `conversation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`buyer_session_id` text NOT NULL,
	`active_turn_id` text,
	`active_turn_expires_at` integer,
	`handler` text DEFAULT 'assistant' NOT NULL,
	`control_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buyer_session_id`) REFERENCES `buyer_session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "conversation_id_storage" CHECK("conversation"."id" is null or (typeof("conversation"."id") = 'text' and length("conversation"."id") = 36 and substr("conversation"."id",9,1) = '-' and substr("conversation"."id",14,1) = '-' and substr("conversation"."id",19,1) = '-' and substr("conversation"."id",24,1) = '-' and length(replace("conversation"."id",'-','')) = 32 and replace("conversation"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "conversation_seller_id_storage" CHECK("conversation"."seller_id" is null or (typeof("conversation"."seller_id") = 'text' and length("conversation"."seller_id") = 36 and substr("conversation"."seller_id",9,1) = '-' and substr("conversation"."seller_id",14,1) = '-' and substr("conversation"."seller_id",19,1) = '-' and substr("conversation"."seller_id",24,1) = '-' and length(replace("conversation"."seller_id",'-','')) = 32 and replace("conversation"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "conversation_buyer_session_id_storage" CHECK("conversation"."buyer_session_id" is null or (typeof("conversation"."buyer_session_id") = 'text' and length("conversation"."buyer_session_id") = 36 and substr("conversation"."buyer_session_id",9,1) = '-' and substr("conversation"."buyer_session_id",14,1) = '-' and substr("conversation"."buyer_session_id",19,1) = '-' and substr("conversation"."buyer_session_id",24,1) = '-' and length(replace("conversation"."buyer_session_id",'-','')) = 32 and replace("conversation"."buyer_session_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "conversation_active_turn_id_storage" CHECK("conversation"."active_turn_id" is null or (typeof("conversation"."active_turn_id") = 'text' and length("conversation"."active_turn_id") = 36 and substr("conversation"."active_turn_id",9,1) = '-' and substr("conversation"."active_turn_id",14,1) = '-' and substr("conversation"."active_turn_id",19,1) = '-' and substr("conversation"."active_turn_id",24,1) = '-' and length(replace("conversation"."active_turn_id",'-','')) = 32 and replace("conversation"."active_turn_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "conversation_active_turn_expires_at_storage" CHECK("conversation"."active_turn_expires_at" is null or (typeof("conversation"."active_turn_expires_at") = 'integer' and "conversation"."active_turn_expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "conversation_control_revision_storage" CHECK("conversation"."control_revision" is null or (typeof("conversation"."control_revision") = 'integer' and "conversation"."control_revision" between -2147483648 and 2147483647)),
	CONSTRAINT "conversation_created_at_storage" CHECK("conversation"."created_at" is null or (typeof("conversation"."created_at") = 'integer' and "conversation"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "conversation_updated_at_storage" CHECK("conversation"."updated_at" is null or (typeof("conversation"."updated_at") = 'integer' and "conversation"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "conversation_handler_valid" CHECK(handler in ('assistant', 'seller')),
	CONSTRAINT "conversation_control_revision_positive" CHECK("conversation"."control_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_buyer_session_key` ON `conversation` (`buyer_session_id`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_sequence_storage" CHECK("message"."sequence" is null or (typeof("message"."sequence") = 'integer' and "message"."sequence" between -2147483648 and 2147483647)),
	CONSTRAINT "message_conversation_id_storage" CHECK("message"."conversation_id" is null or (typeof("message"."conversation_id") = 'text' and length("message"."conversation_id") = 36 and substr("message"."conversation_id",9,1) = '-' and substr("message"."conversation_id",14,1) = '-' and substr("message"."conversation_id",19,1) = '-' and substr("message"."conversation_id",24,1) = '-' and length(replace("message"."conversation_id",'-','')) = 32 and replace("message"."conversation_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "message_parts_storage" CHECK("message"."parts" is null or (typeof("message"."parts") = 'text' and json_valid("message"."parts"))),
	CONSTRAINT "message_created_at_storage" CHECK("message"."created_at" is null or (typeof("message"."created_at") = 'integer' and "message"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "message_role_valid" CHECK(role in ('user', 'assistant')),
	CONSTRAINT "message_id_length" CHECK(length("message"."id") between 1 and 64)
);
--> statement-breakpoint
CREATE INDEX `message_conversation_idx` ON `message` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `owner_conversation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`active_turn_id` text,
	`active_turn_expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "owner_conversation_id_storage" CHECK("owner_conversation"."id" is null or (typeof("owner_conversation"."id") = 'text' and length("owner_conversation"."id") = 36 and substr("owner_conversation"."id",9,1) = '-' and substr("owner_conversation"."id",14,1) = '-' and substr("owner_conversation"."id",19,1) = '-' and substr("owner_conversation"."id",24,1) = '-' and length(replace("owner_conversation"."id",'-','')) = 32 and replace("owner_conversation"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "owner_conversation_seller_id_storage" CHECK("owner_conversation"."seller_id" is null or (typeof("owner_conversation"."seller_id") = 'text' and length("owner_conversation"."seller_id") = 36 and substr("owner_conversation"."seller_id",9,1) = '-' and substr("owner_conversation"."seller_id",14,1) = '-' and substr("owner_conversation"."seller_id",19,1) = '-' and substr("owner_conversation"."seller_id",24,1) = '-' and length(replace("owner_conversation"."seller_id",'-','')) = 32 and replace("owner_conversation"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "owner_conversation_owner_id_storage" CHECK("owner_conversation"."owner_id" is null or (typeof("owner_conversation"."owner_id") = 'text' and length("owner_conversation"."owner_id") = 36 and substr("owner_conversation"."owner_id",9,1) = '-' and substr("owner_conversation"."owner_id",14,1) = '-' and substr("owner_conversation"."owner_id",19,1) = '-' and substr("owner_conversation"."owner_id",24,1) = '-' and length(replace("owner_conversation"."owner_id",'-','')) = 32 and replace("owner_conversation"."owner_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "owner_conversation_active_turn_id_storage" CHECK("owner_conversation"."active_turn_id" is null or (typeof("owner_conversation"."active_turn_id") = 'text' and length("owner_conversation"."active_turn_id") = 36 and substr("owner_conversation"."active_turn_id",9,1) = '-' and substr("owner_conversation"."active_turn_id",14,1) = '-' and substr("owner_conversation"."active_turn_id",19,1) = '-' and substr("owner_conversation"."active_turn_id",24,1) = '-' and length(replace("owner_conversation"."active_turn_id",'-','')) = 32 and replace("owner_conversation"."active_turn_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "owner_conversation_active_turn_expires_at_storage" CHECK("owner_conversation"."active_turn_expires_at" is null or (typeof("owner_conversation"."active_turn_expires_at") = 'integer' and "owner_conversation"."active_turn_expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "owner_conversation_created_at_storage" CHECK("owner_conversation"."created_at" is null or (typeof("owner_conversation"."created_at") = 'integer' and "owner_conversation"."created_at" between -8640000000000000 and 8640000000000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_conversation_scope_key` ON `owner_conversation` (`seller_id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `owner_message` (
	`id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`conversation_id`, `id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `owner_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "owner_message_conversation_id_storage" CHECK("owner_message"."conversation_id" is null or (typeof("owner_message"."conversation_id") = 'text' and length("owner_message"."conversation_id") = 36 and substr("owner_message"."conversation_id",9,1) = '-' and substr("owner_message"."conversation_id",14,1) = '-' and substr("owner_message"."conversation_id",19,1) = '-' and substr("owner_message"."conversation_id",24,1) = '-' and length(replace("owner_message"."conversation_id",'-','')) = 32 and replace("owner_message"."conversation_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "owner_message_sequence_storage" CHECK("owner_message"."sequence" is null or (typeof("owner_message"."sequence") = 'integer' and "owner_message"."sequence" between -2147483648 and 2147483647)),
	CONSTRAINT "owner_message_parts_storage" CHECK("owner_message"."parts" is null or (typeof("owner_message"."parts") = 'text' and json_valid("owner_message"."parts"))),
	CONSTRAINT "owner_message_created_at_storage" CHECK("owner_message"."created_at" is null or (typeof("owner_message"."created_at") = 'integer' and "owner_message"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "owner_message_role_valid" CHECK(role in ('user', 'assistant')),
	CONSTRAINT "owner_message_id_length" CHECK(length("owner_message"."id") between 1 and 64)
);
--> statement-breakpoint
CREATE INDEX `owner_message_history_idx` ON `owner_message` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `digital_quote_line` (
	`quote_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`access_days` integer NOT NULL,
	PRIMARY KEY(`quote_id`, `offer_id`),
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `digital_asset`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "digital_quote_line_quote_id_storage" CHECK("digital_quote_line"."quote_id" is null or (typeof("digital_quote_line"."quote_id") = 'text' and length("digital_quote_line"."quote_id") = 36 and substr("digital_quote_line"."quote_id",9,1) = '-' and substr("digital_quote_line"."quote_id",14,1) = '-' and substr("digital_quote_line"."quote_id",19,1) = '-' and substr("digital_quote_line"."quote_id",24,1) = '-' and length(replace("digital_quote_line"."quote_id",'-','')) = 32 and replace("digital_quote_line"."quote_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "digital_quote_line_offer_id_storage" CHECK("digital_quote_line"."offer_id" is null or (typeof("digital_quote_line"."offer_id") = 'text' and length("digital_quote_line"."offer_id") = 36 and substr("digital_quote_line"."offer_id",9,1) = '-' and substr("digital_quote_line"."offer_id",14,1) = '-' and substr("digital_quote_line"."offer_id",19,1) = '-' and substr("digital_quote_line"."offer_id",24,1) = '-' and length(replace("digital_quote_line"."offer_id",'-','')) = 32 and replace("digital_quote_line"."offer_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "digital_quote_line_asset_id_storage" CHECK("digital_quote_line"."asset_id" is null or (typeof("digital_quote_line"."asset_id") = 'text' and length("digital_quote_line"."asset_id") = 36 and substr("digital_quote_line"."asset_id",9,1) = '-' and substr("digital_quote_line"."asset_id",14,1) = '-' and substr("digital_quote_line"."asset_id",19,1) = '-' and substr("digital_quote_line"."asset_id",24,1) = '-' and length(replace("digital_quote_line"."asset_id",'-','')) = 32 and replace("digital_quote_line"."asset_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "digital_quote_line_access_days_storage" CHECK("digital_quote_line"."access_days" is null or (typeof("digital_quote_line"."access_days") = 'integer' and "digital_quote_line"."access_days" between -2147483648 and 2147483647)),
	CONSTRAINT "digital_quote_line_access_days_valid" CHECK("digital_quote_line"."access_days" between 1 and 3650)
);
--> statement-breakpoint
CREATE TABLE `quote` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`thread_id` text NOT NULL,
	`revision` integer NOT NULL,
	`seller_id` text NOT NULL,
	`buyer_session_id` text NOT NULL,
	`status` text NOT NULL,
	`lines` text NOT NULL,
	`charges` text NOT NULL,
	`unresolved` text DEFAULT '[]' NOT NULL,
	`policy_snapshot` text NOT NULL,
	`subtotal_minor` integer,
	`total_minor` integer,
	`currency` text NOT NULL,
	`buyer_note` text,
	`budget_minor` integer,
	`delivery_requested` integer DEFAULT false NOT NULL,
	`review_reason` text,
	`approved_scope` text,
	`seller_approved_at` integer,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buyer_session_id`) REFERENCES `buyer_session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quote_id_storage" CHECK("quote"."id" is null or (typeof("quote"."id") = 'text' and length("quote"."id") = 36 and substr("quote"."id",9,1) = '-' and substr("quote"."id",14,1) = '-' and substr("quote"."id",19,1) = '-' and substr("quote"."id",24,1) = '-' and length(replace("quote"."id",'-','')) = 32 and replace("quote"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "quote_thread_id_storage" CHECK("quote"."thread_id" is null or (typeof("quote"."thread_id") = 'text' and length("quote"."thread_id") = 36 and substr("quote"."thread_id",9,1) = '-' and substr("quote"."thread_id",14,1) = '-' and substr("quote"."thread_id",19,1) = '-' and substr("quote"."thread_id",24,1) = '-' and length(replace("quote"."thread_id",'-','')) = 32 and replace("quote"."thread_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "quote_revision_storage" CHECK("quote"."revision" is null or (typeof("quote"."revision") = 'integer' and "quote"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "quote_seller_id_storage" CHECK("quote"."seller_id" is null or (typeof("quote"."seller_id") = 'text' and length("quote"."seller_id") = 36 and substr("quote"."seller_id",9,1) = '-' and substr("quote"."seller_id",14,1) = '-' and substr("quote"."seller_id",19,1) = '-' and substr("quote"."seller_id",24,1) = '-' and length(replace("quote"."seller_id",'-','')) = 32 and replace("quote"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "quote_buyer_session_id_storage" CHECK("quote"."buyer_session_id" is null or (typeof("quote"."buyer_session_id") = 'text' and length("quote"."buyer_session_id") = 36 and substr("quote"."buyer_session_id",9,1) = '-' and substr("quote"."buyer_session_id",14,1) = '-' and substr("quote"."buyer_session_id",19,1) = '-' and substr("quote"."buyer_session_id",24,1) = '-' and length(replace("quote"."buyer_session_id",'-','')) = 32 and replace("quote"."buyer_session_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "quote_lines_storage" CHECK("quote"."lines" is null or (typeof("quote"."lines") = 'text' and json_valid("quote"."lines"))),
	CONSTRAINT "quote_charges_storage" CHECK("quote"."charges" is null or (typeof("quote"."charges") = 'text' and json_valid("quote"."charges"))),
	CONSTRAINT "quote_unresolved_storage" CHECK("quote"."unresolved" is null or (typeof("quote"."unresolved") = 'text' and json_valid("quote"."unresolved"))),
	CONSTRAINT "quote_policy_snapshot_storage" CHECK("quote"."policy_snapshot" is null or (typeof("quote"."policy_snapshot") = 'text' and json_valid("quote"."policy_snapshot"))),
	CONSTRAINT "quote_subtotal_minor_storage" CHECK("quote"."subtotal_minor" is null or (typeof("quote"."subtotal_minor") = 'integer' and "quote"."subtotal_minor" between -2147483648 and 2147483647)),
	CONSTRAINT "quote_total_minor_storage" CHECK("quote"."total_minor" is null or (typeof("quote"."total_minor") = 'integer' and "quote"."total_minor" between -2147483648 and 2147483647)),
	CONSTRAINT "quote_budget_minor_storage" CHECK("quote"."budget_minor" is null or (typeof("quote"."budget_minor") = 'integer' and "quote"."budget_minor" between -2147483648 and 2147483647)),
	CONSTRAINT "quote_delivery_requested_storage" CHECK("quote"."delivery_requested" is null or (typeof("quote"."delivery_requested") = 'integer' and "quote"."delivery_requested" in (0, 1))),
	CONSTRAINT "quote_seller_approved_at_storage" CHECK("quote"."seller_approved_at" is null or (typeof("quote"."seller_approved_at") = 'integer' and "quote"."seller_approved_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "quote_expires_at_storage" CHECK("quote"."expires_at" is null or (typeof("quote"."expires_at") = 'integer' and "quote"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "quote_accepted_at_storage" CHECK("quote"."accepted_at" is null or (typeof("quote"."accepted_at") = 'integer' and "quote"."accepted_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "quote_created_at_storage" CHECK("quote"."created_at" is null or (typeof("quote"."created_at") = 'integer' and "quote"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "quote_updated_at_storage" CHECK("quote"."updated_at" is null or (typeof("quote"."updated_at") = 'integer' and "quote"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "quote_status_valid" CHECK(status in ('needs_information', 'seller_review', 'review_ready', 'accepted', 'consumed', 'expired', 'replaced', 'cancelled')),
	CONSTRAINT "quote_totals_valid" CHECK(("quote"."subtotal_minor" is null and "quote"."total_minor" is null) or ("quote"."subtotal_minor" is not null and "quote"."total_minor" is not null and "quote"."subtotal_minor" >= 0 and "quote"."total_minor" >= "quote"."subtotal_minor")),
	CONSTRAINT "quote_total_cap" CHECK("quote"."total_minor" <= 100000000),
	CONSTRAINT "quote_payable_has_total" CHECK("quote"."status" not in ('review_ready', 'accepted', 'consumed') or ("quote"."total_minor" is not null and "quote"."total_minor" > 0)),
	CONSTRAINT "quote_note_length" CHECK(length(coalesce("quote"."buyer_note", '')) <= 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_thread_revision_key` ON `quote` (`thread_id`,`revision`);--> statement-breakpoint
CREATE INDEX `quote_buyer_session_idx` ON `quote` (`buyer_session_id`);--> statement-breakpoint
CREATE INDEX `quote_status_idx` ON `quote` (`status`);--> statement-breakpoint
CREATE TABLE `reservation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`offer_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "reservation_id_storage" CHECK("reservation"."id" is null or (typeof("reservation"."id") = 'text' and length("reservation"."id") = 36 and substr("reservation"."id",9,1) = '-' and substr("reservation"."id",14,1) = '-' and substr("reservation"."id",19,1) = '-' and substr("reservation"."id",24,1) = '-' and length(replace("reservation"."id",'-','')) = 32 and replace("reservation"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "reservation_offer_id_storage" CHECK("reservation"."offer_id" is null or (typeof("reservation"."offer_id") = 'text' and length("reservation"."offer_id") = 36 and substr("reservation"."offer_id",9,1) = '-' and substr("reservation"."offer_id",14,1) = '-' and substr("reservation"."offer_id",19,1) = '-' and substr("reservation"."offer_id",24,1) = '-' and length(replace("reservation"."offer_id",'-','')) = 32 and replace("reservation"."offer_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "reservation_quote_id_storage" CHECK("reservation"."quote_id" is null or (typeof("reservation"."quote_id") = 'text' and length("reservation"."quote_id") = 36 and substr("reservation"."quote_id",9,1) = '-' and substr("reservation"."quote_id",14,1) = '-' and substr("reservation"."quote_id",19,1) = '-' and substr("reservation"."quote_id",24,1) = '-' and length(replace("reservation"."quote_id",'-','')) = 32 and replace("reservation"."quote_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "reservation_quantity_storage" CHECK("reservation"."quantity" is null or (typeof("reservation"."quantity") = 'integer' and "reservation"."quantity" between -2147483648 and 2147483647)),
	CONSTRAINT "reservation_expires_at_storage" CHECK("reservation"."expires_at" is null or (typeof("reservation"."expires_at") = 'integer' and "reservation"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "reservation_created_at_storage" CHECK("reservation"."created_at" is null or (typeof("reservation"."created_at") = 'integer' and "reservation"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "reservation_updated_at_storage" CHECK("reservation"."updated_at" is null or (typeof("reservation"."updated_at") = 'integer' and "reservation"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "reservation_quantity_positive" CHECK("reservation"."quantity" > 0),
	CONSTRAINT "reservation_state_valid" CHECK(state in ('held', 'captured', 'released', 'attention'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservation_quote_offer_key` ON `reservation` (`quote_id`,`offer_id`);--> statement-breakpoint
CREATE INDEX `reservation_state_expiry_idx` ON `reservation` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`number` integer NOT NULL,
	`seller_id` text NOT NULL,
	`payment_attempt_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`buyer_session_id` text NOT NULL,
	`environment` text NOT NULL,
	`provider_order_id` text NOT NULL,
	`provider_capture_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`total_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`buyer_name` text,
	`buyer_email` text,
	`paid_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempt`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`buyer_session_id`) REFERENCES `buyer_session`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_id_storage" CHECK("orders"."id" is null or (typeof("orders"."id") = 'text' and length("orders"."id") = 36 and substr("orders"."id",9,1) = '-' and substr("orders"."id",14,1) = '-' and substr("orders"."id",19,1) = '-' and substr("orders"."id",24,1) = '-' and length(replace("orders"."id",'-','')) = 32 and replace("orders"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "orders_number_storage" CHECK("orders"."number" is null or (typeof("orders"."number") = 'integer' and "orders"."number" between -2147483648 and 2147483647)),
	CONSTRAINT "orders_seller_id_storage" CHECK("orders"."seller_id" is null or (typeof("orders"."seller_id") = 'text' and length("orders"."seller_id") = 36 and substr("orders"."seller_id",9,1) = '-' and substr("orders"."seller_id",14,1) = '-' and substr("orders"."seller_id",19,1) = '-' and substr("orders"."seller_id",24,1) = '-' and length(replace("orders"."seller_id",'-','')) = 32 and replace("orders"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "orders_payment_attempt_id_storage" CHECK("orders"."payment_attempt_id" is null or (typeof("orders"."payment_attempt_id") = 'text' and length("orders"."payment_attempt_id") = 36 and substr("orders"."payment_attempt_id",9,1) = '-' and substr("orders"."payment_attempt_id",14,1) = '-' and substr("orders"."payment_attempt_id",19,1) = '-' and substr("orders"."payment_attempt_id",24,1) = '-' and length(replace("orders"."payment_attempt_id",'-','')) = 32 and replace("orders"."payment_attempt_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "orders_quote_id_storage" CHECK("orders"."quote_id" is null or (typeof("orders"."quote_id") = 'text' and length("orders"."quote_id") = 36 and substr("orders"."quote_id",9,1) = '-' and substr("orders"."quote_id",14,1) = '-' and substr("orders"."quote_id",19,1) = '-' and substr("orders"."quote_id",24,1) = '-' and length(replace("orders"."quote_id",'-','')) = 32 and replace("orders"."quote_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "orders_buyer_session_id_storage" CHECK("orders"."buyer_session_id" is null or (typeof("orders"."buyer_session_id") = 'text' and length("orders"."buyer_session_id") = 36 and substr("orders"."buyer_session_id",9,1) = '-' and substr("orders"."buyer_session_id",14,1) = '-' and substr("orders"."buyer_session_id",19,1) = '-' and substr("orders"."buyer_session_id",24,1) = '-' and length(replace("orders"."buyer_session_id",'-','')) = 32 and replace("orders"."buyer_session_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "orders_snapshot_storage" CHECK("orders"."snapshot" is null or (typeof("orders"."snapshot") = 'text' and json_valid("orders"."snapshot"))),
	CONSTRAINT "orders_total_minor_storage" CHECK("orders"."total_minor" is null or (typeof("orders"."total_minor") = 'integer' and "orders"."total_minor" between -2147483648 and 2147483647)),
	CONSTRAINT "orders_paid_at_storage" CHECK("orders"."paid_at" is null or (typeof("orders"."paid_at") = 'integer' and "orders"."paid_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "orders_created_at_storage" CHECK("orders"."created_at" is null or (typeof("orders"."created_at") = 'integer' and "orders"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "orders_environment_valid" CHECK(environment in ('fixture', 'sandbox')),
	CONSTRAINT "orders_total_positive" CHECK("orders"."total_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_key` ON `orders` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_payment_attempt_key` ON `orders` (`payment_attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_quote_key` ON `orders` (`quote_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_provider_capture_key` ON `orders` (`environment`,`provider_capture_id`);--> statement-breakpoint
CREATE INDEX `orders_paid_at_idx` ON `orders` (`paid_at`);--> statement-breakpoint
CREATE TABLE `payment_attempt` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`environment` text NOT NULL,
	`state` text NOT NULL,
	`create_request_id` text NOT NULL,
	`create_request_hash` text NOT NULL,
	`capture_request_id` text NOT NULL,
	`capture_request_hash` text,
	`provider_order_id` text,
	`provider_capture_id` text,
	`approval_url` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`payee_merchant_id` text,
	`lease_owner` text,
	`lease_expires_at` integer,
	`fence` integer DEFAULT 0 NOT NULL,
	`uncertain_since` integer,
	`next_check_at` integer,
	`check_count` integer DEFAULT 0 NOT NULL,
	`last_provider_status` text,
	`last_error` text,
	`evidence` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quote_id`) REFERENCES `quote`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_attempt_id_storage" CHECK("payment_attempt"."id" is null or (typeof("payment_attempt"."id") = 'text' and length("payment_attempt"."id") = 36 and substr("payment_attempt"."id",9,1) = '-' and substr("payment_attempt"."id",14,1) = '-' and substr("payment_attempt"."id",19,1) = '-' and substr("payment_attempt"."id",24,1) = '-' and length(replace("payment_attempt"."id",'-','')) = 32 and replace("payment_attempt"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "payment_attempt_seller_id_storage" CHECK("payment_attempt"."seller_id" is null or (typeof("payment_attempt"."seller_id") = 'text' and length("payment_attempt"."seller_id") = 36 and substr("payment_attempt"."seller_id",9,1) = '-' and substr("payment_attempt"."seller_id",14,1) = '-' and substr("payment_attempt"."seller_id",19,1) = '-' and substr("payment_attempt"."seller_id",24,1) = '-' and length(replace("payment_attempt"."seller_id",'-','')) = 32 and replace("payment_attempt"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "payment_attempt_quote_id_storage" CHECK("payment_attempt"."quote_id" is null or (typeof("payment_attempt"."quote_id") = 'text' and length("payment_attempt"."quote_id") = 36 and substr("payment_attempt"."quote_id",9,1) = '-' and substr("payment_attempt"."quote_id",14,1) = '-' and substr("payment_attempt"."quote_id",19,1) = '-' and substr("payment_attempt"."quote_id",24,1) = '-' and length(replace("payment_attempt"."quote_id",'-','')) = 32 and replace("payment_attempt"."quote_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "payment_attempt_create_request_id_storage" CHECK("payment_attempt"."create_request_id" is null or (typeof("payment_attempt"."create_request_id") = 'text' and length("payment_attempt"."create_request_id") = 36 and substr("payment_attempt"."create_request_id",9,1) = '-' and substr("payment_attempt"."create_request_id",14,1) = '-' and substr("payment_attempt"."create_request_id",19,1) = '-' and substr("payment_attempt"."create_request_id",24,1) = '-' and length(replace("payment_attempt"."create_request_id",'-','')) = 32 and replace("payment_attempt"."create_request_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "payment_attempt_capture_request_id_storage" CHECK("payment_attempt"."capture_request_id" is null or (typeof("payment_attempt"."capture_request_id") = 'text' and length("payment_attempt"."capture_request_id") = 36 and substr("payment_attempt"."capture_request_id",9,1) = '-' and substr("payment_attempt"."capture_request_id",14,1) = '-' and substr("payment_attempt"."capture_request_id",19,1) = '-' and substr("payment_attempt"."capture_request_id",24,1) = '-' and length(replace("payment_attempt"."capture_request_id",'-','')) = 32 and replace("payment_attempt"."capture_request_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "payment_attempt_amount_minor_storage" CHECK("payment_attempt"."amount_minor" is null or (typeof("payment_attempt"."amount_minor") = 'integer' and "payment_attempt"."amount_minor" between -2147483648 and 2147483647)),
	CONSTRAINT "payment_attempt_lease_expires_at_storage" CHECK("payment_attempt"."lease_expires_at" is null or (typeof("payment_attempt"."lease_expires_at") = 'integer' and "payment_attempt"."lease_expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "payment_attempt_fence_storage" CHECK("payment_attempt"."fence" is null or (typeof("payment_attempt"."fence") = 'integer' and "payment_attempt"."fence" between -2147483648 and 2147483647)),
	CONSTRAINT "payment_attempt_uncertain_since_storage" CHECK("payment_attempt"."uncertain_since" is null or (typeof("payment_attempt"."uncertain_since") = 'integer' and "payment_attempt"."uncertain_since" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "payment_attempt_next_check_at_storage" CHECK("payment_attempt"."next_check_at" is null or (typeof("payment_attempt"."next_check_at") = 'integer' and "payment_attempt"."next_check_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "payment_attempt_check_count_storage" CHECK("payment_attempt"."check_count" is null or (typeof("payment_attempt"."check_count") = 'integer' and "payment_attempt"."check_count" between -2147483648 and 2147483647)),
	CONSTRAINT "payment_attempt_evidence_storage" CHECK("payment_attempt"."evidence" is null or (typeof("payment_attempt"."evidence") = 'text' and json_valid("payment_attempt"."evidence"))),
	CONSTRAINT "payment_attempt_paid_at_storage" CHECK("payment_attempt"."paid_at" is null or (typeof("payment_attempt"."paid_at") = 'integer' and "payment_attempt"."paid_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "payment_attempt_created_at_storage" CHECK("payment_attempt"."created_at" is null or (typeof("payment_attempt"."created_at") = 'integer' and "payment_attempt"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "payment_attempt_updated_at_storage" CHECK("payment_attempt"."updated_at" is null or (typeof("payment_attempt"."updated_at") = 'integer' and "payment_attempt"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "payment_attempt_state_valid" CHECK(state in ('planned', 'create_in_flight', 'order_created', 'approval_observed', 'capture_in_flight', 'verification_pending', 'paid', 'failed', 'cancelled')),
	CONSTRAINT "payment_attempt_environment_valid" CHECK(environment in ('fixture', 'sandbox')),
	CONSTRAINT "payment_attempt_amount_positive" CHECK("payment_attempt"."amount_minor" > 0),
	CONSTRAINT "payment_attempt_paid_has_capture" CHECK("payment_attempt"."state" <> 'paid' or "payment_attempt"."provider_capture_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempt_quote_key` ON `payment_attempt` (`quote_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempt_create_request_key` ON `payment_attempt` (`create_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempt_capture_request_key` ON `payment_attempt` (`capture_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempt_provider_order_key` ON `payment_attempt` (`environment`,`provider_order_id`) WHERE "payment_attempt"."provider_order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempt_provider_capture_key` ON `payment_attempt` (`environment`,`provider_capture_id`) WHERE "payment_attempt"."provider_capture_id" is not null;--> statement-breakpoint
CREATE INDEX `payment_attempt_due_idx` ON `payment_attempt` (`state`,`next_check_at`);--> statement-breakpoint
CREATE TABLE `access_grant` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`order_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`capability_hash` text NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`last_download_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `digital_asset`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "access_grant_id_storage" CHECK("access_grant"."id" is null or (typeof("access_grant"."id") = 'text' and length("access_grant"."id") = 36 and substr("access_grant"."id",9,1) = '-' and substr("access_grant"."id",14,1) = '-' and substr("access_grant"."id",19,1) = '-' and substr("access_grant"."id",24,1) = '-' and length(replace("access_grant"."id",'-','')) = 32 and replace("access_grant"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "access_grant_order_id_storage" CHECK("access_grant"."order_id" is null or (typeof("access_grant"."order_id") = 'text' and length("access_grant"."order_id") = 36 and substr("access_grant"."order_id",9,1) = '-' and substr("access_grant"."order_id",14,1) = '-' and substr("access_grant"."order_id",19,1) = '-' and substr("access_grant"."order_id",24,1) = '-' and length(replace("access_grant"."order_id",'-','')) = 32 and replace("access_grant"."order_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "access_grant_asset_id_storage" CHECK("access_grant"."asset_id" is null or (typeof("access_grant"."asset_id") = 'text' and length("access_grant"."asset_id") = 36 and substr("access_grant"."asset_id",9,1) = '-' and substr("access_grant"."asset_id",14,1) = '-' and substr("access_grant"."asset_id",19,1) = '-' and substr("access_grant"."asset_id",24,1) = '-' and length(replace("access_grant"."asset_id",'-','')) = 32 and replace("access_grant"."asset_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "access_grant_expires_at_storage" CHECK("access_grant"."expires_at" is null or (typeof("access_grant"."expires_at") = 'integer' and "access_grant"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "access_grant_download_count_storage" CHECK("access_grant"."download_count" is null or (typeof("access_grant"."download_count") = 'integer' and "access_grant"."download_count" between -2147483648 and 2147483647)),
	CONSTRAINT "access_grant_last_download_at_storage" CHECK("access_grant"."last_download_at" is null or (typeof("access_grant"."last_download_at") = 'integer' and "access_grant"."last_download_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "access_grant_created_at_storage" CHECK("access_grant"."created_at" is null or (typeof("access_grant"."created_at") = 'integer' and "access_grant"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "access_grant_updated_at_storage" CHECK("access_grant"."updated_at" is null or (typeof("access_grant"."updated_at") = 'integer' and "access_grant"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "access_grant_state_valid" CHECK(state in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_grant_order_asset_key` ON `access_grant` (`order_id`,`asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `access_grant_capability_key` ON `access_grant` (`capability_hash`);--> statement-breakpoint
CREATE TABLE `fulfillment_task` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`order_id` text NOT NULL,
	`type` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`details` text DEFAULT '{}' NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fulfillment_task_id_storage" CHECK("fulfillment_task"."id" is null or (typeof("fulfillment_task"."id") = 'text' and length("fulfillment_task"."id") = 36 and substr("fulfillment_task"."id",9,1) = '-' and substr("fulfillment_task"."id",14,1) = '-' and substr("fulfillment_task"."id",19,1) = '-' and substr("fulfillment_task"."id",24,1) = '-' and length(replace("fulfillment_task"."id",'-','')) = 32 and replace("fulfillment_task"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "fulfillment_task_order_id_storage" CHECK("fulfillment_task"."order_id" is null or (typeof("fulfillment_task"."order_id") = 'text' and length("fulfillment_task"."order_id") = 36 and substr("fulfillment_task"."order_id",9,1) = '-' and substr("fulfillment_task"."order_id",14,1) = '-' and substr("fulfillment_task"."order_id",19,1) = '-' and substr("fulfillment_task"."order_id",24,1) = '-' and length(replace("fulfillment_task"."order_id",'-','')) = 32 and replace("fulfillment_task"."order_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "fulfillment_task_revision_storage" CHECK("fulfillment_task"."revision" is null or (typeof("fulfillment_task"."revision") = 'integer' and "fulfillment_task"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "fulfillment_task_retry_count_storage" CHECK("fulfillment_task"."retry_count" is null or (typeof("fulfillment_task"."retry_count") = 'integer' and "fulfillment_task"."retry_count" between -2147483648 and 2147483647)),
	CONSTRAINT "fulfillment_task_details_storage" CHECK("fulfillment_task"."details" is null or (typeof("fulfillment_task"."details") = 'text' and json_valid("fulfillment_task"."details"))),
	CONSTRAINT "fulfillment_task_completed_at_storage" CHECK("fulfillment_task"."completed_at" is null or (typeof("fulfillment_task"."completed_at") = 'integer' and "fulfillment_task"."completed_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "fulfillment_task_created_at_storage" CHECK("fulfillment_task"."created_at" is null or (typeof("fulfillment_task"."created_at") = 'integer' and "fulfillment_task"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "fulfillment_task_updated_at_storage" CHECK("fulfillment_task"."updated_at" is null or (typeof("fulfillment_task"."updated_at") = 'integer' and "fulfillment_task"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "fulfillment_task_type_valid" CHECK(type in ('pickup', 'service_followup', 'service_work', 'digital_access')),
	CONSTRAINT "fulfillment_task_state_valid" CHECK(state in ('pending', 'in_progress', 'completed', 'attention'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_task_order_type_key` ON `fulfillment_task` (`order_id`,`type`);--> statement-breakpoint
CREATE INDEX `fulfillment_task_state_idx` ON `fulfillment_task` (`state`);--> statement-breakpoint
CREATE TABLE `owner_proposal` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`verb` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`args` text NOT NULL,
	`args_hash` text NOT NULL,
	`summary` text NOT NULL,
	`state` text NOT NULL,
	`result` text,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "owner_proposal_id_storage" CHECK("owner_proposal"."id" is null or (typeof("owner_proposal"."id") = 'text' and length("owner_proposal"."id") = 36 and substr("owner_proposal"."id",9,1) = '-' and substr("owner_proposal"."id",14,1) = '-' and substr("owner_proposal"."id",19,1) = '-' and substr("owner_proposal"."id",24,1) = '-' and length(replace("owner_proposal"."id",'-','')) = 32 and replace("owner_proposal"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "owner_proposal_seller_id_storage" CHECK("owner_proposal"."seller_id" is null or (typeof("owner_proposal"."seller_id") = 'text' and length("owner_proposal"."seller_id") = 36 and substr("owner_proposal"."seller_id",9,1) = '-' and substr("owner_proposal"."seller_id",14,1) = '-' and substr("owner_proposal"."seller_id",19,1) = '-' and substr("owner_proposal"."seller_id",24,1) = '-' and length(replace("owner_proposal"."seller_id",'-','')) = 32 and replace("owner_proposal"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "owner_proposal_target_id_storage" CHECK("owner_proposal"."target_id" is null or (typeof("owner_proposal"."target_id") = 'text' and length("owner_proposal"."target_id") = 36 and substr("owner_proposal"."target_id",9,1) = '-' and substr("owner_proposal"."target_id",14,1) = '-' and substr("owner_proposal"."target_id",19,1) = '-' and substr("owner_proposal"."target_id",24,1) = '-' and length(replace("owner_proposal"."target_id",'-','')) = 32 and replace("owner_proposal"."target_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "owner_proposal_target_revision_storage" CHECK("owner_proposal"."target_revision" is null or (typeof("owner_proposal"."target_revision") = 'integer' and "owner_proposal"."target_revision" between -2147483648 and 2147483647)),
	CONSTRAINT "owner_proposal_args_storage" CHECK("owner_proposal"."args" is null or (typeof("owner_proposal"."args") = 'text' and json_valid("owner_proposal"."args"))),
	CONSTRAINT "owner_proposal_result_storage" CHECK("owner_proposal"."result" is null or (typeof("owner_proposal"."result") = 'text' and json_valid("owner_proposal"."result"))),
	CONSTRAINT "owner_proposal_expires_at_storage" CHECK("owner_proposal"."expires_at" is null or (typeof("owner_proposal"."expires_at") = 'integer' and "owner_proposal"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "owner_proposal_decided_at_storage" CHECK("owner_proposal"."decided_at" is null or (typeof("owner_proposal"."decided_at") = 'integer' and "owner_proposal"."decided_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "owner_proposal_created_at_storage" CHECK("owner_proposal"."created_at" is null or (typeof("owner_proposal"."created_at") = 'integer' and "owner_proposal"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "owner_proposal_state_valid" CHECK(state in ('pending', 'executed', 'rejected', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `owner_proposal_state_idx` ON `owner_proposal` (`state`);--> statement-breakpoint
CREATE TABLE `order_followup` (
	`order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor` text NOT NULL,
	`state` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`order_id`, `revision`),
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_followup_order_id_storage" CHECK("order_followup"."order_id" is null or (typeof("order_followup"."order_id") = 'text' and length("order_followup"."order_id") = 36 and substr("order_followup"."order_id",9,1) = '-' and substr("order_followup"."order_id",14,1) = '-' and substr("order_followup"."order_id",19,1) = '-' and substr("order_followup"."order_id",24,1) = '-' and length(replace("order_followup"."order_id",'-','')) = 32 and replace("order_followup"."order_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "order_followup_revision_storage" CHECK("order_followup"."revision" is null or (typeof("order_followup"."revision") = 'integer' and "order_followup"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "order_followup_created_at_storage" CHECK("order_followup"."created_at" is null or (typeof("order_followup"."created_at") = 'integer' and "order_followup"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "order_followup_revision_positive" CHECK("order_followup"."revision" > 0),
	CONSTRAINT "order_followup_actor_state" CHECK(("order_followup"."actor" = 'buyer' and "order_followup"."state" in ('needs_help', 'confirmed')) or ("order_followup"."actor" = 'owner' and "order_followup"."state" = 'awaiting_customer')),
	CONSTRAINT "order_followup_message_length" CHECK(("order_followup"."state" = 'confirmed' and "order_followup"."message" = '') or ("order_followup"."state" <> 'confirmed' and length(trim("order_followup"."message")) between 3 and 1000))
);
--> statement-breakpoint
CREATE TABLE `seller_question` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`buyer_session_id` text NOT NULL,
	`question` text NOT NULL,
	`customer_goal` text NOT NULL,
	`known_facts` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`answer` text,
	`answered_at` integer,
	`resumed_at` integer,
	`resume_claim_id` text,
	`resume_after` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`resume_attempts` integer DEFAULT 0 NOT NULL,
	`resume_error` text,
	`review_claim_id` text,
	`review_claim_expires_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buyer_session_id`) REFERENCES `buyer_session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "seller_question_id_storage" CHECK("seller_question"."id" is null or (typeof("seller_question"."id") = 'text' and length("seller_question"."id") = 36 and substr("seller_question"."id",9,1) = '-' and substr("seller_question"."id",14,1) = '-' and substr("seller_question"."id",19,1) = '-' and substr("seller_question"."id",24,1) = '-' and length(replace("seller_question"."id",'-','')) = 32 and replace("seller_question"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "seller_question_seller_id_storage" CHECK("seller_question"."seller_id" is null or (typeof("seller_question"."seller_id") = 'text' and length("seller_question"."seller_id") = 36 and substr("seller_question"."seller_id",9,1) = '-' and substr("seller_question"."seller_id",14,1) = '-' and substr("seller_question"."seller_id",19,1) = '-' and substr("seller_question"."seller_id",24,1) = '-' and length(replace("seller_question"."seller_id",'-','')) = 32 and replace("seller_question"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "seller_question_conversation_id_storage" CHECK("seller_question"."conversation_id" is null or (typeof("seller_question"."conversation_id") = 'text' and length("seller_question"."conversation_id") = 36 and substr("seller_question"."conversation_id",9,1) = '-' and substr("seller_question"."conversation_id",14,1) = '-' and substr("seller_question"."conversation_id",19,1) = '-' and substr("seller_question"."conversation_id",24,1) = '-' and length(replace("seller_question"."conversation_id",'-','')) = 32 and replace("seller_question"."conversation_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "seller_question_buyer_session_id_storage" CHECK("seller_question"."buyer_session_id" is null or (typeof("seller_question"."buyer_session_id") = 'text' and length("seller_question"."buyer_session_id") = 36 and substr("seller_question"."buyer_session_id",9,1) = '-' and substr("seller_question"."buyer_session_id",14,1) = '-' and substr("seller_question"."buyer_session_id",19,1) = '-' and substr("seller_question"."buyer_session_id",24,1) = '-' and length(replace("seller_question"."buyer_session_id",'-','')) = 32 and replace("seller_question"."buyer_session_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "seller_question_known_facts_storage" CHECK("seller_question"."known_facts" is null or (typeof("seller_question"."known_facts") = 'text' and json_valid("seller_question"."known_facts"))),
	CONSTRAINT "seller_question_answered_at_storage" CHECK("seller_question"."answered_at" is null or (typeof("seller_question"."answered_at") = 'integer' and "seller_question"."answered_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "seller_question_resumed_at_storage" CHECK("seller_question"."resumed_at" is null or (typeof("seller_question"."resumed_at") = 'integer' and "seller_question"."resumed_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "seller_question_resume_claim_id_storage" CHECK("seller_question"."resume_claim_id" is null or (typeof("seller_question"."resume_claim_id") = 'text' and length("seller_question"."resume_claim_id") = 36 and substr("seller_question"."resume_claim_id",9,1) = '-' and substr("seller_question"."resume_claim_id",14,1) = '-' and substr("seller_question"."resume_claim_id",19,1) = '-' and substr("seller_question"."resume_claim_id",24,1) = '-' and length(replace("seller_question"."resume_claim_id",'-','')) = 32 and replace("seller_question"."resume_claim_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "seller_question_resume_after_storage" CHECK("seller_question"."resume_after" is null or (typeof("seller_question"."resume_after") = 'integer' and "seller_question"."resume_after" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "seller_question_resume_attempts_storage" CHECK("seller_question"."resume_attempts" is null or (typeof("seller_question"."resume_attempts") = 'integer' and "seller_question"."resume_attempts" between -2147483648 and 2147483647)),
	CONSTRAINT "seller_question_review_claim_id_storage" CHECK("seller_question"."review_claim_id" is null or (typeof("seller_question"."review_claim_id") = 'text' and length("seller_question"."review_claim_id") = 36 and substr("seller_question"."review_claim_id",9,1) = '-' and substr("seller_question"."review_claim_id",14,1) = '-' and substr("seller_question"."review_claim_id",19,1) = '-' and substr("seller_question"."review_claim_id",24,1) = '-' and length(replace("seller_question"."review_claim_id",'-','')) = 32 and replace("seller_question"."review_claim_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "seller_question_review_claim_expires_at_storage" CHECK("seller_question"."review_claim_expires_at" is null or (typeof("seller_question"."review_claim_expires_at") = 'integer' and "seller_question"."review_claim_expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "seller_question_revision_storage" CHECK("seller_question"."revision" is null or (typeof("seller_question"."revision") = 'integer' and "seller_question"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "seller_question_created_at_storage" CHECK("seller_question"."created_at" is null or (typeof("seller_question"."created_at") = 'integer' and "seller_question"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "seller_question_updated_at_storage" CHECK("seller_question"."updated_at" is null or (typeof("seller_question"."updated_at") = 'integer' and "seller_question"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "seller_question_state_valid" CHECK(state in ('open', 'answered', 'resumed', 'closed')),
	CONSTRAINT "seller_question_lengths" CHECK(length("seller_question"."question") between 1 and 500 and length("seller_question"."customer_goal") between 1 and 500 and ("seller_question"."answer" is null or length("seller_question"."answer") between 1 and 1000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_question_one_waiting_per_conversation` ON `seller_question` (`conversation_id`) WHERE "seller_question"."state" in ('open', 'answered');--> statement-breakpoint
CREATE INDEX `seller_question_seller_state_idx` ON `seller_question` (`seller_id`,`state`);--> statement-breakpoint
CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`actor` text NOT NULL,
	`actor_id` text,
	`operation` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`outcome` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "audit_event_id_storage" CHECK("audit_event"."id" is null or (typeof("audit_event"."id") = 'text' and length("audit_event"."id") = 36 and substr("audit_event"."id",9,1) = '-' and substr("audit_event"."id",14,1) = '-' and substr("audit_event"."id",19,1) = '-' and substr("audit_event"."id",24,1) = '-' and length(replace("audit_event"."id",'-','')) = 32 and replace("audit_event"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "audit_event_details_storage" CHECK("audit_event"."details" is null or (typeof("audit_event"."details") = 'text' and json_valid("audit_event"."details"))),
	CONSTRAINT "audit_event_created_at_storage" CHECK("audit_event"."created_at" is null or (typeof("audit_event"."created_at") = 'integer' and "audit_event"."created_at" between -8640000000000000 and 8640000000000000))
);
--> statement-breakpoint
CREATE INDEX `audit_event_target_idx` ON `audit_event` (`target_id`);--> statement-breakpoint
CREATE INDEX `audit_event_created_idx` ON `audit_event` (`created_at`);--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "job_id_storage" CHECK("job"."id" is null or (typeof("job"."id") = 'text' and length("job"."id") = 36 and substr("job"."id",9,1) = '-' and substr("job"."id",14,1) = '-' and substr("job"."id",19,1) = '-' and substr("job"."id",24,1) = '-' and length(replace("job"."id",'-','')) = 32 and replace("job"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "job_target_id_storage" CHECK("job"."target_id" is null or (typeof("job"."target_id") = 'text' and length("job"."target_id") = 36 and substr("job"."target_id",9,1) = '-' and substr("job"."target_id",14,1) = '-' and substr("job"."target_id",19,1) = '-' and substr("job"."target_id",24,1) = '-' and length(replace("job"."target_id",'-','')) = 32 and replace("job"."target_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "job_attempts_storage" CHECK("job"."attempts" is null or (typeof("job"."attempts") = 'integer' and "job"."attempts" between -2147483648 and 2147483647)),
	CONSTRAINT "job_run_after_storage" CHECK("job"."run_after" is null or (typeof("job"."run_after") = 'integer' and "job"."run_after" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "job_created_at_storage" CHECK("job"."created_at" is null or (typeof("job"."created_at") = 'integer' and "job"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "job_updated_at_storage" CHECK("job"."updated_at" is null or (typeof("job"."updated_at") = 'integer' and "job"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "job_kind_valid" CHECK(kind in ('reconcile_payment', 'grant_access')),
	CONSTRAINT "job_state_valid" CHECK(state in ('pending', 'done', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_kind_target_key` ON `job` (`kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `job_due_idx` ON `job` (`state`,`run_after`);--> statement-breakpoint
CREATE TABLE `operation_key` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`state` text NOT NULL,
	`result` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`scope`, `key`),
	CONSTRAINT "operation_key_result_storage" CHECK("operation_key"."result" is null or (typeof("operation_key"."result") = 'text' and json_valid("operation_key"."result"))),
	CONSTRAINT "operation_key_created_at_storage" CHECK("operation_key"."created_at" is null or (typeof("operation_key"."created_at") = 'integer' and "operation_key"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "operation_key_updated_at_storage" CHECK("operation_key"."updated_at" is null or (typeof("operation_key"."updated_at") = 'integer' and "operation_key"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "operation_key_state_valid" CHECK(state in ('in_progress', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `usage_bucket` (
	`feature` text NOT NULL,
	`principal` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`feature`, `principal`, `window_start`),
	CONSTRAINT "usage_bucket_window_start_storage" CHECK("usage_bucket"."window_start" is null or (typeof("usage_bucket"."window_start") = 'integer' and "usage_bucket"."window_start" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "usage_bucket_count_storage" CHECK("usage_bucket"."count" is null or (typeof("usage_bucket"."count") = 'integer' and "usage_bucket"."count" between -2147483648 and 2147483647))
);
--> statement-breakpoint
CREATE TABLE `webhook_event` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`environment` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`provider_order_id` text,
	`summary` text NOT NULL,
	`processing_state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_error` text,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`processed_at` integer,
	CONSTRAINT "webhook_event_id_storage" CHECK("webhook_event"."id" is null or (typeof("webhook_event"."id") = 'text' and length("webhook_event"."id") = 36 and substr("webhook_event"."id",9,1) = '-' and substr("webhook_event"."id",14,1) = '-' and substr("webhook_event"."id",19,1) = '-' and substr("webhook_event"."id",24,1) = '-' and length(replace("webhook_event"."id",'-','')) = 32 and replace("webhook_event"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "webhook_event_summary_storage" CHECK("webhook_event"."summary" is null or (typeof("webhook_event"."summary") = 'text' and json_valid("webhook_event"."summary"))),
	CONSTRAINT "webhook_event_attempts_storage" CHECK("webhook_event"."attempts" is null or (typeof("webhook_event"."attempts") = 'integer' and "webhook_event"."attempts" between -2147483648 and 2147483647)),
	CONSTRAINT "webhook_event_next_attempt_at_storage" CHECK("webhook_event"."next_attempt_at" is null or (typeof("webhook_event"."next_attempt_at") = 'integer' and "webhook_event"."next_attempt_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "webhook_event_received_at_storage" CHECK("webhook_event"."received_at" is null or (typeof("webhook_event"."received_at") = 'integer' and "webhook_event"."received_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "webhook_event_processed_at_storage" CHECK("webhook_event"."processed_at" is null or (typeof("webhook_event"."processed_at") = 'integer' and "webhook_event"."processed_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "webhook_event_state_valid" CHECK(processing_state in ('received', 'processed', 'failed', 'ignored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_event_provider_key` ON `webhook_event` (`environment`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `webhook_event_due_idx` ON `webhook_event` (`processing_state`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `fixture_fault` (
	`name` text PRIMARY KEY NOT NULL,
	`remaining` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "fixture_fault_remaining_storage" CHECK("fixture_fault"."remaining" is null or (typeof("fixture_fault"."remaining") = 'integer' and "fixture_fault"."remaining" between -2147483648 and 2147483647)),
	CONSTRAINT "fixture_fault_created_at_storage" CHECK("fixture_fault"."created_at" is null or (typeof("fixture_fault"."created_at") = 'integer' and "fixture_fault"."created_at" between -8640000000000000 and 8640000000000000))
);
--> statement-breakpoint
CREATE TABLE `fixture_provider_order` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`reference_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`payee_merchant_id` text NOT NULL,
	`capture_id` text,
	`capture_status` text,
	`capture_request_id` text,
	`capture_amount_minor` integer,
	`payer_name` text,
	`payer_email` text,
	`return_url` text NOT NULL,
	`cancel_url` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`approved_at` integer,
	`captured_at` integer,
	CONSTRAINT "fixture_provider_order_amount_minor_storage" CHECK("fixture_provider_order"."amount_minor" is null or (typeof("fixture_provider_order"."amount_minor") = 'integer' and "fixture_provider_order"."amount_minor" between -2147483648 and 2147483647)),
	CONSTRAINT "fixture_provider_order_capture_amount_minor_storage" CHECK("fixture_provider_order"."capture_amount_minor" is null or (typeof("fixture_provider_order"."capture_amount_minor") = 'integer' and "fixture_provider_order"."capture_amount_minor" between -2147483648 and 2147483647)),
	CONSTRAINT "fixture_provider_order_created_at_storage" CHECK("fixture_provider_order"."created_at" is null or (typeof("fixture_provider_order"."created_at") = 'integer' and "fixture_provider_order"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "fixture_provider_order_approved_at_storage" CHECK("fixture_provider_order"."approved_at" is null or (typeof("fixture_provider_order"."approved_at") = 'integer' and "fixture_provider_order"."approved_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "fixture_provider_order_captured_at_storage" CHECK("fixture_provider_order"."captured_at" is null or (typeof("fixture_provider_order"."captured_at") = 'integer' and "fixture_provider_order"."captured_at" between -8640000000000000 and 8640000000000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fixture_provider_order_request_key` ON `fixture_provider_order` (`request_id`);--> statement-breakpoint
CREATE TABLE `learning_review` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`question_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`source` text NOT NULL,
	`analysis` text NOT NULL,
	`edited_drafts` text DEFAULT '[]' NOT NULL,
	`generator` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `seller_question`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learning_review_id_storage" CHECK("learning_review"."id" is null or (typeof("learning_review"."id") = 'text' and length("learning_review"."id") = 36 and substr("learning_review"."id",9,1) = '-' and substr("learning_review"."id",14,1) = '-' and substr("learning_review"."id",19,1) = '-' and substr("learning_review"."id",24,1) = '-' and length(replace("learning_review"."id",'-','')) = 32 and replace("learning_review"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_review_seller_id_storage" CHECK("learning_review"."seller_id" is null or (typeof("learning_review"."seller_id") = 'text' and length("learning_review"."seller_id") = 36 and substr("learning_review"."seller_id",9,1) = '-' and substr("learning_review"."seller_id",14,1) = '-' and substr("learning_review"."seller_id",19,1) = '-' and substr("learning_review"."seller_id",24,1) = '-' and length(replace("learning_review"."seller_id",'-','')) = 32 and replace("learning_review"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_review_question_id_storage" CHECK("learning_review"."question_id" is null or (typeof("learning_review"."question_id") = 'text' and length("learning_review"."question_id") = 36 and substr("learning_review"."question_id",9,1) = '-' and substr("learning_review"."question_id",14,1) = '-' and substr("learning_review"."question_id",19,1) = '-' and substr("learning_review"."question_id",24,1) = '-' and length(replace("learning_review"."question_id",'-','')) = 32 and replace("learning_review"."question_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_review_source_storage" CHECK("learning_review"."source" is null or (typeof("learning_review"."source") = 'text' and json_valid("learning_review"."source"))),
	CONSTRAINT "learning_review_analysis_storage" CHECK("learning_review"."analysis" is null or (typeof("learning_review"."analysis") = 'text' and json_valid("learning_review"."analysis"))),
	CONSTRAINT "learning_review_edited_drafts_storage" CHECK("learning_review"."edited_drafts" is null or (typeof("learning_review"."edited_drafts") = 'text' and json_valid("learning_review"."edited_drafts"))),
	CONSTRAINT "learning_review_revision_storage" CHECK("learning_review"."revision" is null or (typeof("learning_review"."revision") = 'integer' and "learning_review"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "learning_review_created_at_storage" CHECK("learning_review"."created_at" is null or (typeof("learning_review"."created_at") = 'integer' and "learning_review"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "learning_review_updated_at_storage" CHECK("learning_review"."updated_at" is null or (typeof("learning_review"."updated_at") = 'integer' and "learning_review"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "learning_review_state_valid" CHECK(state in ('draft', 'deferred', 'rejected')),
	CONSTRAINT "learning_review_revision_positive" CHECK("learning_review"."revision" > 0),
	CONSTRAINT "learning_review_source_hash_length" CHECK(length("learning_review"."source_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_review_source_unique` ON `learning_review` (`seller_id`,`question_id`,`source_hash`);--> statement-breakpoint
CREATE INDEX `learning_review_seller_state_idx` ON `learning_review` (`seller_id`,`state`);--> statement-breakpoint
CREATE TABLE `shop_guide` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`body` text NOT NULL,
	`action_label` text,
	`action_url` text,
	`published` integer DEFAULT false NOT NULL,
	`product_id` text,
	`valid_until` integer,
	`archived` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `offer`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shop_guide_id_storage" CHECK("shop_guide"."id" is null or (typeof("shop_guide"."id") = 'text' and length("shop_guide"."id") = 36 and substr("shop_guide"."id",9,1) = '-' and substr("shop_guide"."id",14,1) = '-' and substr("shop_guide"."id",19,1) = '-' and substr("shop_guide"."id",24,1) = '-' and length(replace("shop_guide"."id",'-','')) = 32 and replace("shop_guide"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "shop_guide_seller_id_storage" CHECK("shop_guide"."seller_id" is null or (typeof("shop_guide"."seller_id") = 'text' and length("shop_guide"."seller_id") = 36 and substr("shop_guide"."seller_id",9,1) = '-' and substr("shop_guide"."seller_id",14,1) = '-' and substr("shop_guide"."seller_id",19,1) = '-' and substr("shop_guide"."seller_id",24,1) = '-' and length(replace("shop_guide"."seller_id",'-','')) = 32 and replace("shop_guide"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "shop_guide_published_storage" CHECK("shop_guide"."published" is null or (typeof("shop_guide"."published") = 'integer' and "shop_guide"."published" in (0, 1))),
	CONSTRAINT "shop_guide_product_id_storage" CHECK("shop_guide"."product_id" is null or (typeof("shop_guide"."product_id") = 'text' and length("shop_guide"."product_id") = 36 and substr("shop_guide"."product_id",9,1) = '-' and substr("shop_guide"."product_id",14,1) = '-' and substr("shop_guide"."product_id",19,1) = '-' and substr("shop_guide"."product_id",24,1) = '-' and length(replace("shop_guide"."product_id",'-','')) = 32 and replace("shop_guide"."product_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "shop_guide_valid_until_storage" CHECK("shop_guide"."valid_until" is null or (typeof("shop_guide"."valid_until") = 'integer' and "shop_guide"."valid_until" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "shop_guide_archived_storage" CHECK("shop_guide"."archived" is null or (typeof("shop_guide"."archived") = 'integer' and "shop_guide"."archived" in (0, 1))),
	CONSTRAINT "shop_guide_revision_storage" CHECK("shop_guide"."revision" is null or (typeof("shop_guide"."revision") = 'integer' and "shop_guide"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "shop_guide_created_at_storage" CHECK("shop_guide"."created_at" is null or (typeof("shop_guide"."created_at") = 'integer' and "shop_guide"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "shop_guide_updated_at_storage" CHECK("shop_guide"."updated_at" is null or (typeof("shop_guide"."updated_at") = 'integer' and "shop_guide"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "shop_guide_revision_positive" CHECK("shop_guide"."revision" > 0),
	CONSTRAINT "shop_guide_archived_unpublished" CHECK(not "shop_guide"."archived" or not "shop_guide"."published"),
	CONSTRAINT "shop_guide_title_length" CHECK(length("shop_guide"."title") between 3 and 100),
	CONSTRAINT "shop_guide_body_length" CHECK(length("shop_guide"."body") between 10 and 2000),
	CONSTRAINT "shop_guide_topic_valid" CHECK(topic in ('shipping', 'returns', 'options', 'booking', 'subscriptions', 'downloads', 'general')),
	CONSTRAINT "shop_guide_action_pair" CHECK(("shop_guide"."action_label" is null and "shop_guide"."action_url" is null) or ("shop_guide"."action_label" is not null and "shop_guide"."action_url" is not null and length("shop_guide"."action_label") between 1 and 60 and length("shop_guide"."action_url") between 1 and 1500 and "shop_guide"."action_url" like 'https://%'))
);
--> statement-breakpoint
CREATE INDEX `shop_guide_seller_idx` ON `shop_guide` (`seller_id`);--> statement-breakpoint
CREATE TABLE `shop_guide_version` (
	`guide_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`guide_id`, `revision`),
	FOREIGN KEY (`guide_id`) REFERENCES `shop_guide`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shop_guide_version_guide_id_storage" CHECK("shop_guide_version"."guide_id" is null or (typeof("shop_guide_version"."guide_id") = 'text' and length("shop_guide_version"."guide_id") = 36 and substr("shop_guide_version"."guide_id",9,1) = '-' and substr("shop_guide_version"."guide_id",14,1) = '-' and substr("shop_guide_version"."guide_id",19,1) = '-' and substr("shop_guide_version"."guide_id",24,1) = '-' and length(replace("shop_guide_version"."guide_id",'-','')) = 32 and replace("shop_guide_version"."guide_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "shop_guide_version_seller_id_storage" CHECK("shop_guide_version"."seller_id" is null or (typeof("shop_guide_version"."seller_id") = 'text' and length("shop_guide_version"."seller_id") = 36 and substr("shop_guide_version"."seller_id",9,1) = '-' and substr("shop_guide_version"."seller_id",14,1) = '-' and substr("shop_guide_version"."seller_id",19,1) = '-' and substr("shop_guide_version"."seller_id",24,1) = '-' and length(replace("shop_guide_version"."seller_id",'-','')) = 32 and replace("shop_guide_version"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "shop_guide_version_revision_storage" CHECK("shop_guide_version"."revision" is null or (typeof("shop_guide_version"."revision") = 'integer' and "shop_guide_version"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "shop_guide_version_snapshot_storage" CHECK("shop_guide_version"."snapshot" is null or (typeof("shop_guide_version"."snapshot") = 'text' and json_valid("shop_guide_version"."snapshot"))),
	CONSTRAINT "shop_guide_version_created_at_storage" CHECK("shop_guide_version"."created_at" is null or (typeof("shop_guide_version"."created_at") = 'integer' and "shop_guide_version"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "shop_guide_version_positive" CHECK("shop_guide_version"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `shop_guide_version_seller_idx` ON `shop_guide_version` (`seller_id`);--> statement-breakpoint
CREATE TABLE `learning_preview` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`review_id` text NOT NULL,
	`review_revision` integer NOT NULL,
	`finding_index` integer NOT NULL,
	`question` text NOT NULL,
	`source_hash` text NOT NULL,
	`draft_body` text NOT NULL,
	`current_facts` text NOT NULL,
	`proposed_facts` text NOT NULL,
	`generator` text NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`current_answer` text,
	`proposed_answer` text,
	`failure` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`review_id`) REFERENCES `learning_review`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "learning_preview_id_storage" CHECK("learning_preview"."id" is null or (typeof("learning_preview"."id") = 'text' and length("learning_preview"."id") = 36 and substr("learning_preview"."id",9,1) = '-' and substr("learning_preview"."id",14,1) = '-' and substr("learning_preview"."id",19,1) = '-' and substr("learning_preview"."id",24,1) = '-' and length(replace("learning_preview"."id",'-','')) = 32 and replace("learning_preview"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_preview_seller_id_storage" CHECK("learning_preview"."seller_id" is null or (typeof("learning_preview"."seller_id") = 'text' and length("learning_preview"."seller_id") = 36 and substr("learning_preview"."seller_id",9,1) = '-' and substr("learning_preview"."seller_id",14,1) = '-' and substr("learning_preview"."seller_id",19,1) = '-' and substr("learning_preview"."seller_id",24,1) = '-' and length(replace("learning_preview"."seller_id",'-','')) = 32 and replace("learning_preview"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_preview_review_id_storage" CHECK("learning_preview"."review_id" is null or (typeof("learning_preview"."review_id") = 'text' and length("learning_preview"."review_id") = 36 and substr("learning_preview"."review_id",9,1) = '-' and substr("learning_preview"."review_id",14,1) = '-' and substr("learning_preview"."review_id",19,1) = '-' and substr("learning_preview"."review_id",24,1) = '-' and length(replace("learning_preview"."review_id",'-','')) = 32 and replace("learning_preview"."review_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_preview_review_revision_storage" CHECK("learning_preview"."review_revision" is null or (typeof("learning_preview"."review_revision") = 'integer' and "learning_preview"."review_revision" between -2147483648 and 2147483647)),
	CONSTRAINT "learning_preview_finding_index_storage" CHECK("learning_preview"."finding_index" is null or (typeof("learning_preview"."finding_index") = 'integer' and "learning_preview"."finding_index" between -2147483648 and 2147483647)),
	CONSTRAINT "learning_preview_current_facts_storage" CHECK("learning_preview"."current_facts" is null or (typeof("learning_preview"."current_facts") = 'text' and json_valid("learning_preview"."current_facts"))),
	CONSTRAINT "learning_preview_proposed_facts_storage" CHECK("learning_preview"."proposed_facts" is null or (typeof("learning_preview"."proposed_facts") = 'text' and json_valid("learning_preview"."proposed_facts"))),
	CONSTRAINT "learning_preview_current_answer_storage" CHECK("learning_preview"."current_answer" is null or (typeof("learning_preview"."current_answer") = 'text' and json_valid("learning_preview"."current_answer"))),
	CONSTRAINT "learning_preview_proposed_answer_storage" CHECK("learning_preview"."proposed_answer" is null or (typeof("learning_preview"."proposed_answer") = 'text' and json_valid("learning_preview"."proposed_answer"))),
	CONSTRAINT "learning_preview_created_at_storage" CHECK("learning_preview"."created_at" is null or (typeof("learning_preview"."created_at") = 'integer' and "learning_preview"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "learning_preview_expires_at_storage" CHECK("learning_preview"."expires_at" is null or (typeof("learning_preview"."expires_at") = 'integer' and "learning_preview"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "learning_preview_state_valid" CHECK(state in ('running', 'completed', 'failed')),
	CONSTRAINT "learning_preview_revision_positive" CHECK("learning_preview"."review_revision" > 0),
	CONSTRAINT "learning_preview_finding_range" CHECK("learning_preview"."finding_index" between 0 and 5),
	CONSTRAINT "learning_preview_question_length" CHECK(length(trim("learning_preview"."question")) between 5 and 1000),
	CONSTRAINT "learning_preview_completed_answers" CHECK("learning_preview"."state" <> 'completed' or ("learning_preview"."current_answer" is not null and "learning_preview"."proposed_answer" is not null))
);
--> statement-breakpoint
CREATE INDEX `learning_preview_seller_created_idx` ON `learning_preview` (`seller_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_preview_one_running` ON `learning_preview` (`seller_id`) WHERE "learning_preview"."state" = 'running';--> statement-breakpoint
CREATE TABLE `learning_publication` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`seller_id` text NOT NULL,
	`review_id` text NOT NULL,
	`finding_index` integer NOT NULL,
	`guide_id` text NOT NULL,
	`guide_revision` integer NOT NULL,
	`approved_input` text NOT NULL,
	`public_source` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`review_id`) REFERENCES `learning_review`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`guide_id`) REFERENCES `shop_guide`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "learning_publication_id_storage" CHECK("learning_publication"."id" is null or (typeof("learning_publication"."id") = 'text' and length("learning_publication"."id") = 36 and substr("learning_publication"."id",9,1) = '-' and substr("learning_publication"."id",14,1) = '-' and substr("learning_publication"."id",19,1) = '-' and substr("learning_publication"."id",24,1) = '-' and length(replace("learning_publication"."id",'-','')) = 32 and replace("learning_publication"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_publication_seller_id_storage" CHECK("learning_publication"."seller_id" is null or (typeof("learning_publication"."seller_id") = 'text' and length("learning_publication"."seller_id") = 36 and substr("learning_publication"."seller_id",9,1) = '-' and substr("learning_publication"."seller_id",14,1) = '-' and substr("learning_publication"."seller_id",19,1) = '-' and substr("learning_publication"."seller_id",24,1) = '-' and length(replace("learning_publication"."seller_id",'-','')) = 32 and replace("learning_publication"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_publication_review_id_storage" CHECK("learning_publication"."review_id" is null or (typeof("learning_publication"."review_id") = 'text' and length("learning_publication"."review_id") = 36 and substr("learning_publication"."review_id",9,1) = '-' and substr("learning_publication"."review_id",14,1) = '-' and substr("learning_publication"."review_id",19,1) = '-' and substr("learning_publication"."review_id",24,1) = '-' and length(replace("learning_publication"."review_id",'-','')) = 32 and replace("learning_publication"."review_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_publication_finding_index_storage" CHECK("learning_publication"."finding_index" is null or (typeof("learning_publication"."finding_index") = 'integer' and "learning_publication"."finding_index" between -2147483648 and 2147483647)),
	CONSTRAINT "learning_publication_guide_id_storage" CHECK("learning_publication"."guide_id" is null or (typeof("learning_publication"."guide_id") = 'text' and length("learning_publication"."guide_id") = 36 and substr("learning_publication"."guide_id",9,1) = '-' and substr("learning_publication"."guide_id",14,1) = '-' and substr("learning_publication"."guide_id",19,1) = '-' and substr("learning_publication"."guide_id",24,1) = '-' and length(replace("learning_publication"."guide_id",'-','')) = 32 and replace("learning_publication"."guide_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "learning_publication_guide_revision_storage" CHECK("learning_publication"."guide_revision" is null or (typeof("learning_publication"."guide_revision") = 'integer' and "learning_publication"."guide_revision" between -2147483648 and 2147483647)),
	CONSTRAINT "learning_publication_approved_input_storage" CHECK("learning_publication"."approved_input" is null or (typeof("learning_publication"."approved_input") = 'text' and json_valid("learning_publication"."approved_input"))),
	CONSTRAINT "learning_publication_public_source_storage" CHECK("learning_publication"."public_source" is null or (typeof("learning_publication"."public_source") = 'text' and json_valid("learning_publication"."public_source"))),
	CONSTRAINT "learning_publication_created_at_storage" CHECK("learning_publication"."created_at" is null or (typeof("learning_publication"."created_at") = 'integer' and "learning_publication"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "learning_publication_finding_range" CHECK("learning_publication"."finding_index" between 0 and 5),
	CONSTRAINT "learning_publication_revision_positive" CHECK("learning_publication"."guide_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_publication_finding_unique` ON `learning_publication` (`review_id`,`finding_index`);--> statement-breakpoint
CREATE INDEX `learning_publication_seller_idx` ON `learning_publication` (`seller_id`);--> statement-breakpoint
CREATE TABLE `assistant_procedure` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`content` text NOT NULL,
	`published_revision` integer,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assistant_procedure_id_storage" CHECK("assistant_procedure"."id" is null or (typeof("assistant_procedure"."id") = 'text' and length("assistant_procedure"."id") = 36 and substr("assistant_procedure"."id",9,1) = '-' and substr("assistant_procedure"."id",14,1) = '-' and substr("assistant_procedure"."id",19,1) = '-' and substr("assistant_procedure"."id",24,1) = '-' and length(replace("assistant_procedure"."id",'-','')) = 32 and replace("assistant_procedure"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "assistant_procedure_seller_id_storage" CHECK("assistant_procedure"."seller_id" is null or (typeof("assistant_procedure"."seller_id") = 'text' and length("assistant_procedure"."seller_id") = 36 and substr("assistant_procedure"."seller_id",9,1) = '-' and substr("assistant_procedure"."seller_id",14,1) = '-' and substr("assistant_procedure"."seller_id",19,1) = '-' and substr("assistant_procedure"."seller_id",24,1) = '-' and length(replace("assistant_procedure"."seller_id",'-','')) = 32 and replace("assistant_procedure"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "assistant_procedure_revision_storage" CHECK("assistant_procedure"."revision" is null or (typeof("assistant_procedure"."revision") = 'integer' and "assistant_procedure"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "assistant_procedure_content_storage" CHECK("assistant_procedure"."content" is null or (typeof("assistant_procedure"."content") = 'text' and json_valid("assistant_procedure"."content"))),
	CONSTRAINT "assistant_procedure_published_revision_storage" CHECK("assistant_procedure"."published_revision" is null or (typeof("assistant_procedure"."published_revision") = 'integer' and "assistant_procedure"."published_revision" between -2147483648 and 2147483647)),
	CONSTRAINT "assistant_procedure_archived_storage" CHECK("assistant_procedure"."archived" is null or (typeof("assistant_procedure"."archived") = 'integer' and "assistant_procedure"."archived" in (0, 1))),
	CONSTRAINT "assistant_procedure_created_at_storage" CHECK("assistant_procedure"."created_at" is null or (typeof("assistant_procedure"."created_at") = 'integer' and "assistant_procedure"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "assistant_procedure_updated_at_storage" CHECK("assistant_procedure"."updated_at" is null or (typeof("assistant_procedure"."updated_at") = 'integer' and "assistant_procedure"."updated_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "assistant_procedure_revision_positive" CHECK("assistant_procedure"."revision" > 0),
	CONSTRAINT "assistant_procedure_publication_valid" CHECK("assistant_procedure"."published_revision" is null or ("assistant_procedure"."published_revision" > 0 and "assistant_procedure"."published_revision" <= "assistant_procedure"."revision" and not "assistant_procedure"."archived"))
);
--> statement-breakpoint
CREATE INDEX `assistant_procedure_seller_idx` ON `assistant_procedure` (`seller_id`);--> statement-breakpoint
CREATE TABLE `assistant_procedure_version` (
	`procedure_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`procedure_id`, `revision`),
	FOREIGN KEY (`procedure_id`) REFERENCES `assistant_procedure`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assistant_procedure_version_procedure_id_storage" CHECK("assistant_procedure_version"."procedure_id" is null or (typeof("assistant_procedure_version"."procedure_id") = 'text' and length("assistant_procedure_version"."procedure_id") = 36 and substr("assistant_procedure_version"."procedure_id",9,1) = '-' and substr("assistant_procedure_version"."procedure_id",14,1) = '-' and substr("assistant_procedure_version"."procedure_id",19,1) = '-' and substr("assistant_procedure_version"."procedure_id",24,1) = '-' and length(replace("assistant_procedure_version"."procedure_id",'-','')) = 32 and replace("assistant_procedure_version"."procedure_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "assistant_procedure_version_seller_id_storage" CHECK("assistant_procedure_version"."seller_id" is null or (typeof("assistant_procedure_version"."seller_id") = 'text' and length("assistant_procedure_version"."seller_id") = 36 and substr("assistant_procedure_version"."seller_id",9,1) = '-' and substr("assistant_procedure_version"."seller_id",14,1) = '-' and substr("assistant_procedure_version"."seller_id",19,1) = '-' and substr("assistant_procedure_version"."seller_id",24,1) = '-' and length(replace("assistant_procedure_version"."seller_id",'-','')) = 32 and replace("assistant_procedure_version"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "assistant_procedure_version_revision_storage" CHECK("assistant_procedure_version"."revision" is null or (typeof("assistant_procedure_version"."revision") = 'integer' and "assistant_procedure_version"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "assistant_procedure_version_content_storage" CHECK("assistant_procedure_version"."content" is null or (typeof("assistant_procedure_version"."content") = 'text' and json_valid("assistant_procedure_version"."content"))),
	CONSTRAINT "assistant_procedure_version_created_at_storage" CHECK("assistant_procedure_version"."created_at" is null or (typeof("assistant_procedure_version"."created_at") = 'integer' and "assistant_procedure_version"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "assistant_procedure_version_positive" CHECK("assistant_procedure_version"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE `procedure_preview` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`procedure_id` text NOT NULL,
	`revision` integer NOT NULL,
	`published_revision` integer,
	`question` text NOT NULL,
	`wording` text NOT NULL,
	`facts` text NOT NULL,
	`current_instructions` text NOT NULL,
	`proposed_instructions` text NOT NULL,
	`generator` text NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`current_answer` text,
	`proposed_answer` text,
	`failure` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`procedure_id`) REFERENCES `assistant_procedure`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "procedure_preview_id_storage" CHECK("procedure_preview"."id" is null or (typeof("procedure_preview"."id") = 'text' and length("procedure_preview"."id") = 36 and substr("procedure_preview"."id",9,1) = '-' and substr("procedure_preview"."id",14,1) = '-' and substr("procedure_preview"."id",19,1) = '-' and substr("procedure_preview"."id",24,1) = '-' and length(replace("procedure_preview"."id",'-','')) = 32 and replace("procedure_preview"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "procedure_preview_seller_id_storage" CHECK("procedure_preview"."seller_id" is null or (typeof("procedure_preview"."seller_id") = 'text' and length("procedure_preview"."seller_id") = 36 and substr("procedure_preview"."seller_id",9,1) = '-' and substr("procedure_preview"."seller_id",14,1) = '-' and substr("procedure_preview"."seller_id",19,1) = '-' and substr("procedure_preview"."seller_id",24,1) = '-' and length(replace("procedure_preview"."seller_id",'-','')) = 32 and replace("procedure_preview"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "procedure_preview_procedure_id_storage" CHECK("procedure_preview"."procedure_id" is null or (typeof("procedure_preview"."procedure_id") = 'text' and length("procedure_preview"."procedure_id") = 36 and substr("procedure_preview"."procedure_id",9,1) = '-' and substr("procedure_preview"."procedure_id",14,1) = '-' and substr("procedure_preview"."procedure_id",19,1) = '-' and substr("procedure_preview"."procedure_id",24,1) = '-' and length(replace("procedure_preview"."procedure_id",'-','')) = 32 and replace("procedure_preview"."procedure_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "procedure_preview_revision_storage" CHECK("procedure_preview"."revision" is null or (typeof("procedure_preview"."revision") = 'integer' and "procedure_preview"."revision" between -2147483648 and 2147483647)),
	CONSTRAINT "procedure_preview_published_revision_storage" CHECK("procedure_preview"."published_revision" is null or (typeof("procedure_preview"."published_revision") = 'integer' and "procedure_preview"."published_revision" between -2147483648 and 2147483647)),
	CONSTRAINT "procedure_preview_wording_storage" CHECK("procedure_preview"."wording" is null or (typeof("procedure_preview"."wording") = 'text' and json_valid("procedure_preview"."wording"))),
	CONSTRAINT "procedure_preview_facts_storage" CHECK("procedure_preview"."facts" is null or (typeof("procedure_preview"."facts") = 'text' and json_valid("procedure_preview"."facts"))),
	CONSTRAINT "procedure_preview_current_instructions_storage" CHECK("procedure_preview"."current_instructions" is null or (typeof("procedure_preview"."current_instructions") = 'text' and json_valid("procedure_preview"."current_instructions"))),
	CONSTRAINT "procedure_preview_proposed_instructions_storage" CHECK("procedure_preview"."proposed_instructions" is null or (typeof("procedure_preview"."proposed_instructions") = 'text' and json_valid("procedure_preview"."proposed_instructions"))),
	CONSTRAINT "procedure_preview_current_answer_storage" CHECK("procedure_preview"."current_answer" is null or (typeof("procedure_preview"."current_answer") = 'text' and json_valid("procedure_preview"."current_answer"))),
	CONSTRAINT "procedure_preview_proposed_answer_storage" CHECK("procedure_preview"."proposed_answer" is null or (typeof("procedure_preview"."proposed_answer") = 'text' and json_valid("procedure_preview"."proposed_answer"))),
	CONSTRAINT "procedure_preview_created_at_storage" CHECK("procedure_preview"."created_at" is null or (typeof("procedure_preview"."created_at") = 'integer' and "procedure_preview"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "procedure_preview_expires_at_storage" CHECK("procedure_preview"."expires_at" is null or (typeof("procedure_preview"."expires_at") = 'integer' and "procedure_preview"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "procedure_preview_state_valid" CHECK(state in ('running', 'completed', 'failed')),
	CONSTRAINT "procedure_preview_revision_positive" CHECK("procedure_preview"."revision" > 0),
	CONSTRAINT "procedure_preview_question_length" CHECK(length(trim("procedure_preview"."question")) between 5 and 1000),
	CONSTRAINT "procedure_preview_completed_answers" CHECK("procedure_preview"."state" <> 'completed' or ("procedure_preview"."current_answer" is not null and "procedure_preview"."proposed_answer" is not null))
);
--> statement-breakpoint
CREATE INDEX `procedure_preview_seller_created_idx` ON `procedure_preview` (`seller_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `procedure_preview_one_running` ON `procedure_preview` (`seller_id`) WHERE "procedure_preview"."state" = 'running';--> statement-breakpoint
CREATE TABLE `simulation_run` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`input` text NOT NULL,
	`snapshot` text NOT NULL,
	`change` text,
	`generator` text NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`current_result` text,
	`proposed_result` text,
	`failure` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "simulation_run_id_storage" CHECK("simulation_run"."id" is null or (typeof("simulation_run"."id") = 'text' and length("simulation_run"."id") = 36 and substr("simulation_run"."id",9,1) = '-' and substr("simulation_run"."id",14,1) = '-' and substr("simulation_run"."id",19,1) = '-' and substr("simulation_run"."id",24,1) = '-' and length(replace("simulation_run"."id",'-','')) = 32 and replace("simulation_run"."id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "simulation_run_seller_id_storage" CHECK("simulation_run"."seller_id" is null or (typeof("simulation_run"."seller_id") = 'text' and length("simulation_run"."seller_id") = 36 and substr("simulation_run"."seller_id",9,1) = '-' and substr("simulation_run"."seller_id",14,1) = '-' and substr("simulation_run"."seller_id",19,1) = '-' and substr("simulation_run"."seller_id",24,1) = '-' and length(replace("simulation_run"."seller_id",'-','')) = 32 and replace("simulation_run"."seller_id",'-','') not glob '*[^0-9a-f]*')),
	CONSTRAINT "simulation_run_input_storage" CHECK("simulation_run"."input" is null or (typeof("simulation_run"."input") = 'text' and json_valid("simulation_run"."input"))),
	CONSTRAINT "simulation_run_snapshot_storage" CHECK("simulation_run"."snapshot" is null or (typeof("simulation_run"."snapshot") = 'text' and json_valid("simulation_run"."snapshot"))),
	CONSTRAINT "simulation_run_change_storage" CHECK("simulation_run"."change" is null or (typeof("simulation_run"."change") = 'text' and json_valid("simulation_run"."change"))),
	CONSTRAINT "simulation_run_current_result_storage" CHECK("simulation_run"."current_result" is null or (typeof("simulation_run"."current_result") = 'text' and json_valid("simulation_run"."current_result"))),
	CONSTRAINT "simulation_run_proposed_result_storage" CHECK("simulation_run"."proposed_result" is null or (typeof("simulation_run"."proposed_result") = 'text' and json_valid("simulation_run"."proposed_result"))),
	CONSTRAINT "simulation_run_created_at_storage" CHECK("simulation_run"."created_at" is null or (typeof("simulation_run"."created_at") = 'integer' and "simulation_run"."created_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "simulation_run_expires_at_storage" CHECK("simulation_run"."expires_at" is null or (typeof("simulation_run"."expires_at") = 'integer' and "simulation_run"."expires_at" between -8640000000000000 and 8640000000000000)),
	CONSTRAINT "simulation_run_state_valid" CHECK(state in ('running', 'completed', 'failed')),
	CONSTRAINT "simulation_run_ordered_results" CHECK("simulation_run"."proposed_result" is null or "simulation_run"."current_result" is not null),
	CONSTRAINT "simulation_run_completed_results" CHECK("simulation_run"."state" <> 'completed' or ("simulation_run"."current_result" is not null and ("simulation_run"."change" is null or "simulation_run"."proposed_result" is not null)))
);
--> statement-breakpoint
CREATE INDEX `simulation_run_seller_created_idx` ON `simulation_run` (`seller_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `simulation_run_one_running` ON `simulation_run` (`seller_id`) WHERE "simulation_run"."state" = 'running';