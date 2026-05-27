-- apps/api/src/database/migrations/0014_transport_order_export_log.sql
-- T1 (2026): export-backup ledger table for the Lệnh điều xe Excel feature.
--
-- Records every export (manual or auto on login/logout) so the daily-backup
-- invariant is auditable. The partial unique index on (company_id,
-- operator_id, day_key, trigger) WHERE trigger IN ('login','logout')
-- enforces idempotency for the auto triggers without restricting manual
-- exports.
CREATE TABLE "transport_order_export_log" (
        "export_log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "company_id" uuid NOT NULL,
        "business_unit_id" uuid NOT NULL,
        "depot_id" uuid NOT NULL,
        "legal_entity_id" uuid NOT NULL,
        "operator_id" uuid NOT NULL,
        "trigger" varchar(16) NOT NULL,
        "day_key" varchar(10) NOT NULL,
        "row_count" integer NOT NULL,
        "sha256" varchar(64) NOT NULL,
        "filename" varchar(255) NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "toel_trigger_allowed" CHECK (trigger IN ('manual','login','logout')),
        CONSTRAINT "toel_row_count_nonneg" CHECK (row_count >= 0)
);
--> statement-breakpoint
CREATE INDEX "toel_company_idx" ON "transport_order_export_log" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "toel_operator_day_idx" ON "transport_order_export_log" USING btree ("operator_id","day_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "toel_auto_unique_per_day" ON "transport_order_export_log" USING btree ("company_id","operator_id","day_key","trigger") WHERE trigger IN ('login','logout');
