CREATE TYPE "public"."erp_sync_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."erp_sync_status" AS ENUM('pending', 'sent', 'acknowledged', 'failed');--> statement-breakpoint
CREATE TYPE "public"."manifest_rejection_reason" AS ENUM('blurred_image', 'wrong_manifest', 'missing_page', 'oversized_file', 'unsupported_format', 'duplicate_upload', 'hash_mismatch', 'virus_detected', 'other');--> statement-breakpoint
CREATE TYPE "public"."manifest_state" AS ENUM('pending', 'verifying', 'captured', 'committed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."road_run_state" AS ENUM('planned', 'dispatched', 'started', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transport_order_state" AS ENUM('draft', 'assigned', 'in_transit', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."upload_session_state" AS ENUM('initiated', 'uploading', 'verifying', 'committed', 'rejected', 'aborted');--> statement-breakpoint
CREATE TABLE "device_registry" (
	"device_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"platform" varchar(32) NOT NULL,
	"app_version" varchar(32) NOT NULL,
	"expo_push_token" varchar(256),
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_session" (
	"device_session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"surface" varchar(16) NOT NULL,
	"session_mode" varchar(16) NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(64),
	"revocation_reason_schema_version" uuid,
	"token_consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_customer_map" (
	"erp_customer_map_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"internal_customer_id" uuid NOT NULL,
	"external_erp_id" varchar(128) NOT NULL,
	"erp_system" varchar(64) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_invoice_map" (
	"erp_invoice_map_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"manifest_correlation_id" uuid NOT NULL,
	"transport_order_id" uuid NOT NULL,
	"external_erp_invoice_id" varchar(128),
	"erp_system" varchar(64) NOT NULL,
	"direction" "erp_sync_direction" DEFAULT 'outbound' NOT NULL,
	"status" "erp_sync_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"failure_reason" varchar(256),
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_job_code_map" (
	"erp_job_code_map_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"internal_job_code" varchar(64) NOT NULL,
	"external_erp_code" varchar(128) NOT NULL,
	"erp_system" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_audit_log" (
	"audit_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"server_seq" bigint NOT NULL,
	"operator_id" uuid,
	"event_type" varchar(64) NOT NULL,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest" (
	"manifest_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"transport_order_id" uuid NOT NULL,
	"manifest_correlation_id" uuid NOT NULL,
	"state" "manifest_state" DEFAULT 'pending' NOT NULL,
	"captured_by_operator_id" uuid,
	"captured_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"rejection_reason_code" "manifest_rejection_reason",
	"rejection_reason_text" varchar(500),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_manifest_correlation_id_unique" UNIQUE("manifest_correlation_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"outbox_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"queue_name" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_run" (
	"road_run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"state" "road_run_state" DEFAULT 'planned' NOT NULL,
	"assigned_operator_id" uuid,
	"assigned_asset_id" uuid,
	"planned_start_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "road_run_completed_after_started" CHECK ("road_run"."completed_at" IS NULL OR "road_run"."started_at" IS NULL OR "road_run"."completed_at" >= "road_run"."started_at")
);
--> statement-breakpoint
CREATE TABLE "road_run_transport_order" (
	"road_run_transport_order_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"road_run_id" uuid NOT NULL,
	"transport_order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	CONSTRAINT "rrto_sequence_positive" CHECK ("road_run_transport_order"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "stop" (
	"stop_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"transport_order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"stop_type" varchar(32) NOT NULL,
	"yard_id" uuid,
	"address" jsonb,
	"planned_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	CONSTRAINT "stop_sequence_positive" CHECK ("stop"."sequence" > 0),
	CONSTRAINT "stop_departed_after_arrived" CHECK ("stop"."departed_at" IS NULL OR "stop"."arrived_at" IS NULL OR "stop"."departed_at" >= "stop"."arrived_at")
);
--> statement-breakpoint
CREATE TABLE "sync_change_feed" (
	"feed_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"server_seq" bigint NOT NULL,
	"action_id" uuid NOT NULL,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"delta" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_order" (
	"transport_order_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"external_ref" varchar(64),
	"state" "transport_order_state" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_order_updated_after_created" CHECK ("transport_order"."updated_at" >= "transport_order"."created_at")
);
--> statement-breakpoint
CREATE TABLE "upload_session" (
	"upload_session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"manifest_id" uuid,
	"operator_id" uuid NOT NULL,
	"s3_key" varchar(512) NOT NULL,
	"s3_bucket" varchar(128) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"expected_size_bytes" integer,
	"actual_size_bytes" integer,
	"state" "upload_session_state" DEFAULT 'initiated' NOT NULL,
	"content_hash" varchar(128),
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"aborted_at" timestamp with time zone,
	CONSTRAINT "upload_session_size_positive" CHECK ("upload_session"."expected_size_bytes" IS NULL OR "upload_session"."expected_size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "device_session" ADD CONSTRAINT "device_session_device_id_device_registry_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_registry"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest" ADD CONSTRAINT "manifest_transport_order_id_transport_order_transport_order_id_fk" FOREIGN KEY ("transport_order_id") REFERENCES "public"."transport_order"("transport_order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_run_transport_order" ADD CONSTRAINT "road_run_transport_order_road_run_id_road_run_road_run_id_fk" FOREIGN KEY ("road_run_id") REFERENCES "public"."road_run"("road_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_run_transport_order" ADD CONSTRAINT "road_run_transport_order_transport_order_id_transport_order_transport_order_id_fk" FOREIGN KEY ("transport_order_id") REFERENCES "public"."transport_order"("transport_order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop" ADD CONSTRAINT "stop_transport_order_id_transport_order_transport_order_id_fk" FOREIGN KEY ("transport_order_id") REFERENCES "public"."transport_order"("transport_order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_session" ADD CONSTRAINT "upload_session_manifest_id_manifest_manifest_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifest"("manifest_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_registry_operator_idx" ON "device_registry" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "device_registry_company_idx" ON "device_registry" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "device_session_device_idx" ON "device_session" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_session_operator_surface_idx" ON "device_session" USING btree ("operator_id","surface");--> statement-breakpoint
CREATE INDEX "device_session_revoked_at_idx" ON "device_session" USING btree ("revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_session_one_mutating_per_operator_surface_uq" ON "device_session" USING btree ("operator_id","surface") WHERE session_mode = 'mutating' AND revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "erp_customer_map_internal_idx" ON "erp_customer_map" USING btree ("internal_customer_id");--> statement-breakpoint
CREATE INDEX "erp_customer_map_external_idx" ON "erp_customer_map" USING btree ("external_erp_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_customer_map_internal_uq" ON "erp_customer_map" USING btree ("company_id","erp_system","internal_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_customer_map_external_uq" ON "erp_customer_map" USING btree ("company_id","erp_system","external_erp_id");--> statement-breakpoint
CREATE INDEX "erp_invoice_map_correlation_idx" ON "erp_invoice_map" USING btree ("manifest_correlation_id");--> statement-breakpoint
CREATE INDEX "erp_invoice_map_transport_order_idx" ON "erp_invoice_map" USING btree ("transport_order_id");--> statement-breakpoint
CREATE INDEX "erp_invoice_map_status_idx" ON "erp_invoice_map" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_invoice_map_idempotency_uq" ON "erp_invoice_map" USING btree ("manifest_correlation_id","erp_system");--> statement-breakpoint
CREATE INDEX "erp_job_code_map_internal_idx" ON "erp_job_code_map" USING btree ("internal_job_code");--> statement-breakpoint
CREATE INDEX "erp_job_code_map_external_idx" ON "erp_job_code_map" USING btree ("external_erp_code");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_job_code_map_internal_uq" ON "erp_job_code_map" USING btree ("company_id","erp_system","internal_job_code");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_job_code_map_external_uq" ON "erp_job_code_map" USING btree ("company_id","erp_system","external_erp_code");--> statement-breakpoint
CREATE INDEX "fleet_audit_log_operator_event_time_idx" ON "fleet_audit_log" USING btree ("operator_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "fleet_audit_log_aggregate_idx" ON "fleet_audit_log" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "manifest_transport_order_idx" ON "manifest" USING btree ("transport_order_id");--> statement-breakpoint
CREATE INDEX "manifest_state_idx" ON "manifest" USING btree ("state");--> statement-breakpoint
CREATE INDEX "outbox_status_next_attempt_idx" ON "outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_queue_idx" ON "outbox" USING btree ("queue_name");--> statement-breakpoint
CREATE INDEX "road_run_state_idx" ON "road_run" USING btree ("state");--> statement-breakpoint
CREATE INDEX "road_run_operator_idx" ON "road_run" USING btree ("assigned_operator_id");--> statement-breakpoint
CREATE INDEX "rrto_road_run_idx" ON "road_run_transport_order" USING btree ("road_run_id");--> statement-breakpoint
CREATE INDEX "rrto_transport_order_idx" ON "road_run_transport_order" USING btree ("transport_order_id");--> statement-breakpoint
CREATE INDEX "stop_transport_order_idx" ON "stop" USING btree ("transport_order_id");--> statement-breakpoint
CREATE INDEX "stop_yard_idx" ON "stop" USING btree ("yard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_change_feed_action_id_uq" ON "sync_change_feed" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "sync_change_feed_seq_idx" ON "sync_change_feed" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "transport_order_state_idx" ON "transport_order" USING btree ("state");--> statement-breakpoint
CREATE INDEX "transport_order_company_idx" ON "transport_order" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "transport_order_external_ref_idx" ON "transport_order" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "upload_session_manifest_idx" ON "upload_session" USING btree ("manifest_id");--> statement-breakpoint
CREATE INDEX "upload_session_operator_idx" ON "upload_session" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "upload_session_state_idx" ON "upload_session" USING btree ("state");
