ALTER TABLE "offer" DROP CONSTRAINT "offer_price_range";--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT "quote_totals_valid";--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT "quote_payable_has_total";--> statement-breakpoint
ALTER TABLE "offer" ALTER COLUMN "unit_amount_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ALTER COLUMN "subtotal_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ALTER COLUMN "total_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_price_range" CHECK (("offer"."unit_amount_minor" is not null and "offer"."unit_amount_minor" between 1 and 10000000) or ("offer"."unit_amount_minor" is null and "offer"."kind" = 'service' and "offer"."requires_scope_review"));--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_totals_valid" CHECK (("quote"."subtotal_minor" is null and "quote"."total_minor" is null) or ("quote"."subtotal_minor" is not null and "quote"."total_minor" is not null and "quote"."subtotal_minor" >= 0 and "quote"."total_minor" >= "quote"."subtotal_minor"));--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_payable_has_total" CHECK ("quote"."status" not in ('review_ready', 'accepted', 'consumed') or ("quote"."total_minor" is not null and "quote"."total_minor" > 0));