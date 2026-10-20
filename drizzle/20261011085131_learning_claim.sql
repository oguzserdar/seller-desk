ALTER TABLE "seller_question" ADD COLUMN "review_claim_id" uuid;--> statement-breakpoint
ALTER TABLE "seller_question" ADD COLUMN "review_claim_expires_at" timestamp with time zone;