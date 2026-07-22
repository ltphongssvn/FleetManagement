CREATE TABLE "device_attestation_event" (
	"attestation_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"platform" varchar(16) NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"security_level" varchar(32),
	"token_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "installation_id" varchar(128);--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "binding_status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "binding_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "binding_revoked_reason" varchar(64);--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "attestation_key_id" varchar(128);--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "attestation_public_key_spki" text;--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "attestation_security_level" varchar(32);--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "attestation_environment" varchar(32);--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "attestation_counter" integer;--> statement-breakpoint
ALTER TABLE "device_attestation_event" ADD CONSTRAINT "device_attestation_event_device_id_device_registry_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_registry"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_attestation_event_device_idx" ON "device_attestation_event" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_attestation_event_operator_idx" ON "device_attestation_event" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "device_attestation_event_created_idx" ON "device_attestation_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_registry_company_platform_installation_uq" ON "device_registry" USING btree ("company_id","platform","installation_id");
