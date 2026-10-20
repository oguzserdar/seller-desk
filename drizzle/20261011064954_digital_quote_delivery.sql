CREATE TABLE "digital_quote_line" (
	"quote_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"access_days" integer NOT NULL,
	CONSTRAINT "digital_quote_line_quote_id_offer_id_pk" PRIMARY KEY("quote_id","offer_id"),
	CONSTRAINT "digital_quote_line_access_days_valid" CHECK ("digital_quote_line"."access_days" between 1 and 3650)
);
--> statement-breakpoint
ALTER TABLE "digital_quote_line" ADD CONSTRAINT "digital_quote_line_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_quote_line" ADD CONSTRAINT "digital_quote_line_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_quote_line" ADD CONSTRAINT "digital_quote_line_asset_id_digital_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."digital_asset"("id") ON DELETE restrict ON UPDATE no action;