CREATE TABLE "copilot_plan_execution" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'started' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "cpe_status_enum" CHECK (status in ('started', 'completed', 'failed')),
	CONSTRAINT "cpe_completed_at_consistency" CHECK ((status = 'started') = (completed_at is null))
);
