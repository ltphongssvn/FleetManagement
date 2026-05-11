CREATE TABLE "order_sequence" (
	"order_sequence_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"pad_width" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_sequence_company_prefix_uq" UNIQUE("company_id","prefix")
);
