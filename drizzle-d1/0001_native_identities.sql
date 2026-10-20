CREATE TABLE `storage_sequence` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL,
	CONSTRAINT "storage_sequence_name_valid" CHECK("storage_sequence"."name" in ('message', 'owner_message', 'orders')),
	CONSTRAINT "storage_sequence_value_valid" CHECK(typeof("storage_sequence"."value") = 'integer' and "storage_sequence"."value" between 1 and 2147483647)
);
