CREATE TABLE "dispatch_board_projection" (
	"road_run_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"state" "road_run_state" NOT NULL,
	"assigned_operator_id" uuid,
	"assigned_asset_id" uuid,
	"planned_start_at" timestamp with time zone,
	"stop_count" integer DEFAULT 0 NOT NULL,
	"transport_order_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"server_seq" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_board_projection_stop_count_nonneg" CHECK ("dispatch_board_projection"."stop_count" >= 0),
	CONSTRAINT "dispatch_board_projection_server_seq_nonneg" CHECK ("dispatch_board_projection"."server_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projection_status" (
	"projection_name" varchar(64) NOT NULL,
	"scope" varchar(128) NOT NULL,
	"watermark" bigint DEFAULT 0 NOT NULL,
	"lag_ms" integer DEFAULT 0 NOT NULL,
	"last_rebuilt_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projection_status_pkey" PRIMARY KEY("projection_name","scope"),
	CONSTRAINT "projection_status_watermark_nonneg" CHECK ("projection_status"."watermark" >= 0),
	CONSTRAINT "projection_status_lag_ms_nonneg" CHECK ("projection_status"."lag_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX "dispatch_board_projection_state_idx" ON "dispatch_board_projection" USING btree ("state");--> statement-breakpoint
CREATE INDEX "dispatch_board_projection_company_idx" ON "dispatch_board_projection" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "dispatch_board_projection_planned_start_idx" ON "dispatch_board_projection" USING btree ("planned_start_at");
