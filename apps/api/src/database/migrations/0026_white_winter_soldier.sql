CREATE TABLE "driver_refresh_token" (
	"driver_refresh_token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(64),
	"replaced_by_token_hash" varchar(64)
);
--> statement-breakpoint
ALTER TABLE "driver_refresh_token" ADD CONSTRAINT "driver_refresh_token_driver_id_driver_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("driver_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_refresh_token_hash_uq" ON "driver_refresh_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "driver_refresh_token_family_idx" ON "driver_refresh_token" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "driver_refresh_token_driver_idx" ON "driver_refresh_token" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_refresh_token_company_idx" ON "driver_refresh_token" USING btree ("company_id");
