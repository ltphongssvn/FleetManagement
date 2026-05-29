-- apps/api/src/database/migrations/0011_road_run_pair_not_null.sql
--
-- 2026 invariant: a road_run never exists without a bound driver-vehicle
-- pair (assigned_operator_id, assigned_asset_id). The DTO, server action,
-- and TransportOrdersService.create all now require both fields; this is
-- the DB-level last line of defense.
--
-- Pre-flight cleanup: any pre-2026 road_run rows that lack the binding
-- are not legal under the new rule and must be removed before adding the
-- NOT NULL constraint. CASCADE drops their join rows in
-- road_run_transport_order. This is safe because the only writers of
-- partial road_runs were pre-2026 service code paths that have all
-- been removed (see DTO + service-layer commit history). In production
-- this migration runs on databases that have never been used in 2026,
-- so this cleanup typically affects 0 rows.
DELETE FROM "road_run" WHERE "assigned_operator_id" IS NULL OR "assigned_asset_id" IS NULL;--> statement-breakpoint
ALTER TABLE "road_run" ALTER COLUMN "assigned_operator_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "road_run" ALTER COLUMN "assigned_asset_id" SET NOT NULL;
