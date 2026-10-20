CREATE TABLE `storage_identity` (
	`singleton` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`id` text NOT NULL,
	CONSTRAINT "storage_identity_singleton" CHECK("storage_identity"."singleton"=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_identity_id_unique` ON `storage_identity` (`id`);