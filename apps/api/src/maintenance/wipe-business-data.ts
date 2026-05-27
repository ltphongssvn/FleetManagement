// apps/api/src/maintenance/wipe-business-data.ts
//
// Maintenance utility: empties FACT tables while preserving REFERENCE
// (master) data, schema, migrations, and constraints.
//
// 2026 CQRS best-practice for 'fresh start' in a Command/Query split:
//
//   PURGE (fact / event / read-model tables — caller can recreate by
//   resuming dispatcher actions):
//     transport_order, road_run, road_run_transport_order, stop,
//     outbox, sync_change_feed, dispatch_board_projection,
//     projection_status, order_sequence, manifest, upload_session,
//     fleet_audit_log, transport_order_export_log, erp_invoice_map
//
//   PRESERVE (reference / master data — dispatcher's persistent
//   operational vocabulary):
//     driver, vehicle, customer, warehouse, cargo_type,
//     driver_vehicle_assignment, device_registry, device_session,
//     passkey_credential, erp_customer_map, erp_job_code_map,
//     spatial_ref_sys
//
// Use case: reset dev/staging environment so the next new transport_order
// is XTT.MM-001 again, WITHOUT destroying the dispatcher's driver list,
// vehicle plates, customer names, warehouse names, cargo types, or
// driver-vehicle pairings.
//
// Implementation: single TRUNCATE ... RESTART IDENTITY CASCADE over the
// explicit fact-table allowlist. One AccessExclusiveLock acquisition,
// no inter-table deadlock window, sequences reset atomically.
//
// SAFETY:
//   - Operates only on the explicit FACT_TABLES allowlist below; any
//     unknown table (including new reference tables added later) is
//     preserved by default.
//   - Production guard at the CLI entrypoint (scripts/wipe-business-data.ts)
//     refuses to run unless FLEET_ALLOW_DESTRUCTIVE_WIPE=true.
//   - This module itself is environment-agnostic so it can be unit-tested
//     against pglite/Testcontainers; the guard is at the caller boundary.
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';

// Accept either node-postgres or pglite drizzle instances. The runtime
// requirement is just .execute(sql).
type AnyDb = NodePgDatabase | PgliteDatabase;

// Explicit allowlist of FACT tables to truncate. Any table NOT in this list
// is preserved (defaults are safe). Ordering doesn't matter for TRUNCATE
// because CASCADE handles FK ordering and the lock is acquired atomically
// across all named relations.
export const FACT_TABLES: readonly string[] = [
  'transport_order',
  'road_run',
  'road_run_transport_order',
  'stop',
  'outbox',
  'sync_change_feed',
  'dispatch_board_projection',
  'projection_status',
  'order_sequence',
  'manifest',
  'upload_session',
  'fleet_audit_log',
  'transport_order_export_log',
  'erp_invoice_map',
];

export async function wipeBusinessData(db: AnyDb): Promise<void> {
  // Filter to tables that actually exist in the schema. New deployments
  // may not have every table yet (e.g. erp_invoice_map only after the
  // ERP integration migration). pg_tables is the canonical source.
  const listSql = "SELECT tablename FROM pg_tables WHERE schemaname = 'public'";
  const r = await db.execute<{ tablename: string }>(sql.raw(listSql));
  const existing = new Set(r.rows.map((row) => row.tablename));
  const targets = FACT_TABLES.filter((t) => existing.has(t));
  if (targets.length === 0) return;

  // Quote names defensively in case any contain reserved words / mixed case.
  const list = targets.map((t) => '"' + t + '"').join(', ');
  await db.execute(sql.raw('TRUNCATE TABLE ' + list + ' RESTART IDENTITY CASCADE'));
}
