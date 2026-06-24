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
// SAFETY (defense in depth - this module is ONE layer, never the only one):
//   - Operates only on the explicit FACT_TABLES allowlist below; any unknown
//     table (including new reference tables added later) is preserved.
//   - This module CONSULTS THE PRODUCTION DESTRUCTIVE-OPERATION GUARD itself
//     (assertDestructiveOperationAllowed) BEFORE any TRUNCATE, so a direct call
//     - not just the CLI entrypoint - cannot wipe production. In production the
//     wipe FAILS CLOSED unless an explicit typed break-glass authorization that
//     names production is supplied. The environment is RESOLVED from trusted
//     process signals (resolveGuardEnvironment), not a caller claim; the optional
//     environment override exists for test dependency-injection only.
//   - The CLI entrypoint (scripts/wipe-business-data.ts) keeps its own
//     FLEET_ALLOW_DESTRUCTIVE_WIPE check as an additional layer.
//   - Deeper layers (DB role without TRUNCATE/DROP, least-privilege per-env
//     credentials, immutable off-site backups, infra deletion protection) are the
//     non-bypassable backstops documented in the runbook.
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import {
  assertDestructiveOperationAllowed,
  resolveGuardEnvironment,
  type GuardEnvironment,
  type BreakGlassAuthorization,
} from './destructive-operation-guard.js';

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

/** Options for wipeBusinessData. environment is a TEST-ONLY dependency-injection
 *  override; in real callers it is omitted and resolved from trusted process
 *  signals. authorization is the typed break-glass token (null = none). Both field
 *  types are schema-derived from the guard contract (no hand-written data shape). */
export async function wipeBusinessData(
  db: AnyDb,
  opts?: { environment?: GuardEnvironment; authorization?: BreakGlassAuthorization | null },
): Promise<void> {
  // DEFENSE IN DEPTH: consult the production guard BEFORE any database work. In
  // production this throws DestructiveOperationBlockedError unless a production-named
  // break-glass is supplied; in dev/test/staging it is a no-op. The environment is
  // resolved from trusted process signals unless explicitly injected (tests only).
  assertDestructiveOperationAllowed({
    operation: 'wipe_business_data',
    environment: opts?.environment ?? resolveGuardEnvironment(),
    tableCount: FACT_TABLES.length,
    authorization: opts?.authorization ?? null,
  });
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
