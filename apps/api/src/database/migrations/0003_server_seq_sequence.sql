-- apps/api/src/database/migrations/0003_server_seq_sequence.sql
-- Fix MAX(server_seq)+1 race in CommandsController.issue() and SyncService.applyActions().
-- Introduces a Postgres sequence as the single source of truth for monotonic server_seq.
-- Forward-only per PDF "Forward-only migrations". Backfill seeds sequence past existing max.
CREATE SEQUENCE IF NOT EXISTS fleet_server_seq AS bigint MINVALUE 1 NO CYCLE;
--> statement-breakpoint
SELECT setval(
  'fleet_server_seq',
  GREATEST(
    (SELECT COALESCE(MAX(server_seq), 0) FROM sync_change_feed),
    (SELECT COALESCE(MAX(server_seq), 0) FROM fleet_audit_log),
    1
  )
);
