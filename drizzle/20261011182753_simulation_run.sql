CREATE TABLE "simulation_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change" jsonb,
	"generator" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"current_result" jsonb,
	"proposed_result" jsonb,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "simulation_run_state_valid" CHECK (state in ('running', 'completed', 'failed')),
	CONSTRAINT "simulation_run_ordered_results" CHECK ("simulation_run"."proposed_result" is null or "simulation_run"."current_result" is not null),
	CONSTRAINT "simulation_run_completed_results" CHECK ("simulation_run"."state" <> 'completed' or ("simulation_run"."current_result" is not null and ("simulation_run"."change" is null or "simulation_run"."proposed_result" is not null)))
);
--> statement-breakpoint
ALTER TABLE "simulation_run" ADD CONSTRAINT "simulation_run_seller_id_seller_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "simulation_run_seller_created_idx" ON "simulation_run" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_run_one_running" ON "simulation_run" USING btree ("seller_id") WHERE "simulation_run"."state" = 'running';