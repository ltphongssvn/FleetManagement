// e2e/dispatch-fresh-start-after-purge.spec.ts
// T4 (2026-Q2) acceptance: after operator runs the wipeBusinessData
// utility, the dispatch board is empty AND the first newly created
// transport_order receives external_ref XTT.MM-001 (sequence restarts).
//
// Business invariants:
//   (1) Fact tables purged (transport_order, road_run, stop, projection,
//       outbox, sync_change_feed, order_sequence) so next ref is XTT.MM-001.
//   (2) Reference tables preserved (driver, vehicle, customer, warehouse,
//       cargo_type, driver_vehicle_assignment) so dispatcher's Quản lý
//       dữ liệu điều phối + Quản lý tài xế & xe operational vocabulary
//       survives.
//   (3) NO LEAK: this spec must not contaminate reference tables with any
//       PRESERVE-* or E2E-T4-FRESH-* rows. Industry-standard 2026 pattern:
//       self-contained scenarios with try/finally cleanup + post-suite
//       assertion that the database is clean.
//
// 2026-07-23 root fix: this spec used to carry its OWN copy of
// mintDispatcherToken that hardcoded the container name 'fleet-pilot-api-1'
// and validated the response with a bare out.includes('.') check. Under the
// isolated per-worktree stack (compose project fleet-<hash>) that literal name
// does not exist, so every run failed with "No such container". The copy was
// the drift source: helpers/auth.ts already exports a correct minter that
// resolves the container from E2E_API_CONTAINER and parses the response
// through TokenResponseSchema. The duplicate is deleted; this file now imports
// the single source of truth, and the wipe call goes through dockerExecApiNode
// so it resolves the same way.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { dockerPsql, dockerExecApiNode } from './helpers/docker-exec';
import { mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, CreateTransportOrderResponseSchema } from './helpers/contracts';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';

function currentMonth2(): string {
  const m = new Date().getUTCMonth() + 1;
  return m.toString().padStart(2, '0');
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}

// Track every row this spec creates so the finally block can delete it.
interface SeededIds {
  driverIds: string[];
  vehicleIds: string[];
  customerIds: string[];
  warehouseIds: string[];
  cargoTypeIds: string[];
  pairIds: string[];
}

function deleteSeededRows(seeded: SeededIds): void {
  const sq = String.fromCharCode(39);
  const quoteList = (ids: readonly string[]): string =>
    ids.map((id) => sq + id + sq).join(',');
  // Order matters under FK constraints: pairs -> orders/runs (already wiped)
  // -> drivers/vehicles -> customers/warehouses/cargo. Tolerate not-found.
  if (seeded.pairIds.length > 0) {
    dockerPsql('DELETE FROM driver_vehicle_assignment WHERE assignment_id IN (' + quoteList(seeded.pairIds) + ');');
  }
  if (seeded.driverIds.length > 0) {
    dockerPsql('DELETE FROM driver WHERE driver_id IN (' + quoteList(seeded.driverIds) + ');');
  }
  if (seeded.vehicleIds.length > 0) {
    dockerPsql('DELETE FROM vehicle WHERE vehicle_id IN (' + quoteList(seeded.vehicleIds) + ');');
  }
  if (seeded.customerIds.length > 0) {
    dockerPsql('DELETE FROM customer WHERE customer_id IN (' + quoteList(seeded.customerIds) + ');');
  }
  if (seeded.warehouseIds.length > 0) {
    dockerPsql('DELETE FROM warehouse WHERE warehouse_id IN (' + quoteList(seeded.warehouseIds) + ');');
  }
  if (seeded.cargoTypeIds.length > 0) {
    dockerPsql('DELETE FROM cargo_type WHERE cargo_type_id IN (' + quoteList(seeded.cargoTypeIds) + ');');
  }
}

// Post-suite no-leak guard: refuses to let the spec end if any PRESERVE-* or
// E2E-T4-FRESH-* rows remain in reference tables (defense-in-depth — runs
// even if the try/finally cleanup is incomplete).
test.afterAll(() => {
  const sq = String.fromCharCode(39);
  const probes: readonly (readonly [string, string, string])[] = [
    ['driver',     'full_name', 'PRESERVE %'],
    ['driver',     'full_name', 'E2E DRIVER T4-FRESH %'],
    ['vehicle',    'plate',     'PRESERVE-%'],
    ['vehicle',    'plate',     'E2E-T4-FRESH-%'],
    ['customer',   'name',      'PRESERVE-%'],
    ['warehouse',  'name',      'PRESERVE-%'],
    ['cargo_type', 'name',      'PRESERVE-%'],
  ];
  const leaks: string[] = [];
  for (const probe of probes) {
    const tbl = probe[0]; const col = probe[1]; const pat = probe[2];
    const r = dockerPsql('SELECT COUNT(*) FROM ' + tbl + ' WHERE ' + col + ' LIKE ' + sq + pat + sq + ';');
    if (r.failed) continue;
    const n = Number(r.stdout.trim());
    if (n > 0) leaks.push(tbl + '.' + col + ' LIKE ' + sq + pat + sq + ' = ' + String(n));
  }
  if (leaks.length > 0) {
    const nl = String.fromCharCode(10);
    throw new Error('T4 no-leak violation — spec left reference rows behind:' + nl + '  ' + leaks.join(nl + '  '));
  }
});

// This spec mutates GLOBAL database state (wipe + sequence reset) so it
// cannot run concurrently with itself OR with other dispatch specs.
// Per Playwright 2026 guidance for shared-state suites: declare serial
// mode AND force --workers=1 at the runner. We also tag with @serial
// so CI can exclude this from parallel shards.
test.describe.configure({ mode: 'serial' });
test.describe('dispatch fresh start after wipe (T4) @serial', () => {
  test('after wipeBusinessData runs, dispatch board is empty and next order is XTT.MM-001', async ({ request }) => {
    test.setTimeout(90_000);
    const seeded: SeededIds = {
      driverIds: [], vehicleIds: [], customerIds: [], warehouseIds: [], cargoTypeIds: [], pairIds: [],
    };
    try {
      // ---- Pre-seed reference data BEFORE the wipe (to prove preservation) ----
      const preToken = mintDispatcherToken();
      const preTs = Date.now();
      const preRand = Math.floor(Math.random() * 1e9).toString(36);
      const preDrv = await adminPost(
        request, preToken, '/admin/drivers',
        { fullName: 'PRESERVE DRIVER T4 ' + String(preTs) + '-' + preRand, phone: '08' + String(preTs).slice(-8), password: 'e2e-pass-1234' }, // pragma: allowlist secret
        CreateDriverResponseSchema,
      );
      seeded.driverIds.push(preDrv.driverId);
      const preVeh = await adminPost(request, preToken, '/reference/vehicles', { name: 'PRESERVE-VEH-' + preRand }, ReferenceItemSchema);
      seeded.vehicleIds.push(preVeh.id);
      const prePair = await adminPost(
        request, preToken, '/admin/driver-vehicle-assignments',
        { driverId: preDrv.driverId, vehicleId: preVeh.id },
        AssignmentResponseSchema,
      );
      seeded.pairIds.push(prePair.assignmentId);
      const preCust = await adminPost(request, preToken, '/reference/customers', { name: 'PRESERVE-CUST-' + preRand }, ReferenceItemSchema);
      seeded.customerIds.push(preCust.id);
      const preWh = await adminPost(request, preToken, '/reference/warehouses', { name: 'PRESERVE-WH-' + preRand }, ReferenceItemSchema);
      seeded.warehouseIds.push(preWh.id);
      const preCargo = await adminPost(request, preToken, '/reference/cargo-types', { name: 'PRESERVE-CARGO-' + preRand }, ReferenceItemSchema);
      seeded.cargoTypeIds.push(preCargo.id);

      const driversBefore = dockerPsql('SELECT COUNT(*) FROM driver WHERE active=true;').stdout.trim();
      const vehiclesBefore = dockerPsql('SELECT COUNT(*) FROM vehicle WHERE active=true;').stdout.trim();
      const customersBefore = dockerPsql('SELECT COUNT(*) FROM customer;').stdout.trim();
      const warehousesBefore = dockerPsql('SELECT COUNT(*) FROM warehouse;').stdout.trim();
      const cargoBefore = dockerPsql('SELECT COUNT(*) FROM cargo_type;').stdout.trim();
      const pairsBefore = dockerPsql('SELECT COUNT(*) FROM driver_vehicle_assignment WHERE revoked_at IS NULL;').stdout.trim();
      expect(Number(driversBefore)).toBeGreaterThan(0);
      expect(Number(vehiclesBefore)).toBeGreaterThan(0);
      expect(Number(customersBefore)).toBeGreaterThan(0);
      expect(Number(warehousesBefore)).toBeGreaterThan(0);
      expect(Number(cargoBefore)).toBeGreaterThan(0);
      expect(Number(pairsBefore)).toBeGreaterThan(0);

      // ---- Run the wipe via the production wipeBusinessData() module ----
      const wipeOut = dockerExecApiNode(
        'import(' + JSON.stringify('./dist/maintenance/wipe-business-data.js') + ').then(m=>m.wipeBusinessData(require(' + JSON.stringify('drizzle-orm/node-postgres') + ').drizzle(new (require(' + JSON.stringify('pg') + ').Pool)({connectionString:process.env.DATABASE_URL}))),{environment:' + JSON.stringify('production') + ',authorization:{confirmedEnvironment:' + JSON.stringify('production') + ',reason:' + JSON.stringify('e2e T4 acceptance fresh-start wipe (operator-confirmed)') + '}}).then(()=>process.stdout.write(' + JSON.stringify('WIPE-OK') + ')).catch(e=>{console.error(e);process.exit(1)})',
      );
      expect(wipeOut).toContain('WIPE-OK');

      // INVARIANT 1 (preservation): reference/master data MUST survive the wipe.
      const driversAfter = dockerPsql('SELECT COUNT(*) FROM driver WHERE active=true;').stdout.trim();
      const vehiclesAfter = dockerPsql('SELECT COUNT(*) FROM vehicle WHERE active=true;').stdout.trim();
      const customersAfter = dockerPsql('SELECT COUNT(*) FROM customer;').stdout.trim();
      const warehousesAfter = dockerPsql('SELECT COUNT(*) FROM warehouse;').stdout.trim();
      const cargoAfter = dockerPsql('SELECT COUNT(*) FROM cargo_type;').stdout.trim();
      const pairsAfter = dockerPsql('SELECT COUNT(*) FROM driver_vehicle_assignment WHERE revoked_at IS NULL;').stdout.trim();
      expect(driversAfter, 'driver rows must be preserved across wipe').toBe(driversBefore);
      expect(vehiclesAfter, 'vehicle rows must be preserved across wipe').toBe(vehiclesBefore);
      expect(customersAfter, 'customer rows must be preserved across wipe').toBe(customersBefore);
      expect(warehousesAfter, 'warehouse rows must be preserved across wipe').toBe(warehousesBefore);
      expect(cargoAfter, 'cargo_type rows must be preserved across wipe').toBe(cargoBefore);
      expect(pairsAfter, 'driver_vehicle_assignment rows must be preserved across wipe').toBe(pairsBefore);

      // INVARIANT 2 (purge): fact tables are empty after wipe.
      const sq = String.fromCharCode(39);
      const orders = dockerPsql('SELECT COUNT(*) FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
      expect(orders).toBe('0');
      const roadRuns = dockerPsql('SELECT COUNT(*) FROM road_run WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
      expect(roadRuns).toBe('0');
      const projection = dockerPsql('SELECT COUNT(*) FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
      expect(projection).toBe('0');
      const sequences = dockerPsql('SELECT COUNT(*) FROM order_sequence WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
      expect(sequences).toBe('0');

      // ---- Seed a separate driver+vehicle+pair for the post-wipe order create ----
      const postToken = mintDispatcherToken();
      const postTs = Date.now();
      const postRand = Math.floor(Math.random() * 1e9).toString(36);
      const postDrv = await adminPost(
        request, postToken, '/admin/drivers',
        { fullName: 'E2E DRIVER T4-FRESH ' + String(postTs) + '-' + postRand, phone: '09' + String(postTs).slice(-8), password: 'e2e-pass-1234' }, // pragma: allowlist secret
        CreateDriverResponseSchema,
      );
      seeded.driverIds.push(postDrv.driverId);
      const postVeh = await adminPost(request, postToken, '/reference/vehicles', { name: 'E2E-T4-FRESH-' + postRand }, ReferenceItemSchema);
      seeded.vehicleIds.push(postVeh.id);
      const postPair = await adminPost(
        request, postToken, '/admin/driver-vehicle-assignments',
        { driverId: postDrv.driverId, vehicleId: postVeh.id },
        AssignmentResponseSchema,
      );
      seeded.pairIds.push(postPair.assignmentId);

      // INVARIANT 3 (sequence reset): first create after wipe MUST be XTT.MM-001.
      const created = await adminPost(
        request, postToken, '/transport-orders',
        {
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: { assignedOperatorId: postDrv.operatorId, assignedAssetId: postVeh.id },
        },
        CreateTransportOrderResponseSchema,
      );
      expect(created.externalRef).toBe('XTT.' + currentMonth2() + '-001');

      // ---- Clean up the transport_order we just created (it's a fact row) ----
      // wipeBusinessData would have done it; we just don't want it lingering for
      // the next test or the dispatcher's board to show E2E-T4-FRESH rows.
      const sq2 = String.fromCharCode(39);
      dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq2 + created.transportOrderId + sq2 + ';');
      dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq2 + created.transportOrderId + sq2 + ';');
      dockerPsql('DELETE FROM dispatch_board_projection WHERE road_run_id=' + sq2 + created.roadRunId + sq2 + ';');
      dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq2 + created.roadRunId + sq2 + ';');
      dockerPsql('DELETE FROM outbox WHERE company_id=' + sq2 + COMPANY_ID + sq2 + ' AND payload::text LIKE ' + sq2 + '%' + created.externalRef + '%' + sq2 + ';');
      dockerPsql('DELETE FROM transport_order WHERE transport_order_id=' + sq2 + created.transportOrderId + sq2 + ';');
      dockerPsql('DELETE FROM order_sequence WHERE company_id=' + sq2 + COMPANY_ID + sq2 + ';');
    } finally {
      // Always clean up reference rows we seeded, even if any assertion above
      // failed mid-flight. The afterAll no-leak guard verifies this.
      deleteSeededRows(seeded);
    }
  });
});
