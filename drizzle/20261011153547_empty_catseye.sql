CREATE TABLE "assistant_procedure" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"published_revision" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_procedure_revision_positive" CHECK ("assistant_procedure"."revision" > 0),
	CONSTRAINT "assistant_procedure_publication_valid" CHECK ("assistant_procedure"."published_revision" is null or ("assistant_procedure"."published_revision" > 0 and "assistant_procedure"."published_revision" <= "assistant_procedure"."revision" and not "assistant_procedure"."archived"))
);
--> statement-breakpoint
CREATE TABLE "assistant_procedure_version" (
	"procedure_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_procedure_version_procedure_id_revision_pk" PRIMARY KEY("procedure_id","revision"),
	CONSTRAINT "assistant_procedure_version_positive" CHECK ("assistant_procedure_version"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_procedure" ADD CONSTRAINT "assistant_procedure_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_procedure_version" ADD CONSTRAINT "assistant_procedure_version_procedure_id_assistant_procedure_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."assistant_procedure"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_procedure_version" ADD CONSTRAINT "assistant_procedure_version_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_procedure_seller_idx" ON "assistant_procedure" USING btree ("seller_id");