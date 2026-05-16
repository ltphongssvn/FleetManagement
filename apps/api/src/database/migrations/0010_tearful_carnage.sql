CREATE TABLE "passkey_credential" (
	"passkey_credential_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"device_id" uuid,
	"credential_id" "bytea" NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"aaguid" uuid,
	"transports" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "attestation_platform" varchar(16);--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "attestation_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_registry" ADD COLUMN "attestation_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "passkey_credential" ADD CONSTRAINT "passkey_credential_driver_id_driver_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("driver_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credential" ADD CONSTRAINT "passkey_credential_device_id_device_registry_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device_registry"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_credential_id_uq" ON "passkey_credential" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_credential_driver_idx" ON "passkey_credential" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "passkey_credential_company_idx" ON "passkey_credential" USING btree ("company_id");