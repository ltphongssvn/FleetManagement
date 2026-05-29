CREATE TABLE "cargo_type" (
	"cargo_type_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargo_type_company_name_uq" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"customer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_company_name_uq" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "driver" (
	"driver_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"operator_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_company_name_uq" UNIQUE("company_id","full_name")
);
--> statement-breakpoint
CREATE TABLE "vehicle" (
	"vehicle_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"plate" varchar(32) NOT NULL,
	"vehicle_type" varchar(32) DEFAULT 'box_truck' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_company_plate_uq" UNIQUE("company_id","plate")
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"warehouse_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"role" varchar(32) DEFAULT 'pickup' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_company_name_role_uq" UNIQUE("company_id","name","role")
);
--> statement-breakpoint
CREATE INDEX "cargo_type_company_idx" ON "cargo_type" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "customer_company_idx" ON "customer" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "driver_company_idx" ON "driver" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "vehicle_company_idx" ON "vehicle" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "warehouse_company_idx" ON "warehouse" USING btree ("company_id");
