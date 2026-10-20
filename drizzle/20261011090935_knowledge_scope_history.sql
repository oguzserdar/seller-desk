CREATE TABLE "shop_guide_version" (
	"guide_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_guide_version_guide_id_revision_pk" PRIMARY KEY("guide_id","revision"),
	CONSTRAINT "shop_guide_version_positive" CHECK ("shop_guide_version"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "shop_guide" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_guide" ADD COLUMN "valid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_guide" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_guide_version" ADD CONSTRAINT "shop_guide_version_guide_id_shop_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."shop_guide"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_guide_version" ADD CONSTRAINT "shop_guide_version_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_guide_version_seller_idx" ON "shop_guide_version" USING btree ("seller_id");--> statement-breakpoint
ALTER TABLE "shop_guide" ADD CONSTRAINT "shop_guide_product_id_offer_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."offer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_guide" ADD CONSTRAINT "shop_guide_archived_unpublished" CHECK (not "shop_guide"."archived" or not "shop_guide"."published");