-- apps/api/src/database/migrations/0015_driver_password_reset_log.sql
-- Audit ledger for service-desk (admin) driver password resets (2026).
--
-- EXPAND-only, additive, zero-disruption: brand-new table, referenced by NO
-- existing code path or row, so old code running during the deploy overlap is
-- unaffected (safe-continuous-deployment.md). Indexes are created on an empty
-- table in the same statement group, so there is no lock on live data.
-- One row per admin reset, attributing actor_operator_id -> target_driver_id.
-- Stores no password material; the hash lives on the driver row.
CREATE TABLE "driver_password_reset_log" (
	"reset_log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"actor_operator_id" uuid NOT NULL,
	"target_driver_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dprl_company_idx" ON "driver_password_reset_log" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "dprl_target_idx" ON "driver_password_reset_log" USING btree ("target_driver_id");
--> statement-breakpoint
CREATE INDEX "dprl_actor_idx" ON "driver_password_reset_log" USING btree ("actor_operator_id");
