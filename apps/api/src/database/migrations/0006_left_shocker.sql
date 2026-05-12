CREATE TABLE "driver_vehicle_assignment" (
	"assignment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(64)
);
--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignment" ADD CONSTRAINT "driver_vehicle_assignment_driver_id_driver_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("driver_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignment" ADD CONSTRAINT "driver_vehicle_assignment_vehicle_id_vehicle_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("vehicle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dva_driver_idx" ON "driver_vehicle_assignment" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "dva_vehicle_idx" ON "driver_vehicle_assignment" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dva_one_active_per_driver_uq" ON "driver_vehicle_assignment" USING btree ("company_id","driver_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dva_one_active_per_vehicle_uq" ON "driver_vehicle_assignment" USING btree ("company_id","vehicle_id") WHERE revoked_at IS NULL;
