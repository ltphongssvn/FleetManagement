ALTER TABLE "manifest" ADD COLUMN "intake_reconcile_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "manifest" ADD COLUMN "last_intake_reconcile_at" timestamp with time zone;
