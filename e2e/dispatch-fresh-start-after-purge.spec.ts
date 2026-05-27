// e2e/dispatch-fresh-start-after-purge.spec.ts
// T4 (2026-Q2) acceptance: after operator runs the wipeBusinessData
// utility, the dispatch board is empty AND the first newly created
// transport_order receives external_ref XTT.MM-001 (sequence restarts).
//
// Business invariant: 'fresh start' must be observable end-to-end —
// no leftover rows visible to dispatcher, sequence counter resets so
// dispatchers see clean monotonic numbering from 001 again.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { dockerPsql, dockerExecNode } from './helpers/docker-exec';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';

function currentMonth2(): string {
  // XTT.MM-NNN: MM is server-side current month. Compute the same way the
  // numbering service does (Asia/Ho_Chi_Minh wall clock month), but for the
  // spec a UTC-ish month is acceptable since the test runs within seconds.
  const m = new Date().getUTCMonth() + 1;
  return m.toString().padStart(2, '0');
}

async function mintDispatcherToken(): Promise<string> {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = dockerExecNode('fleet-pilot-api-1', script);
  if (!out || !out.includes('.')) throw new Error('Token mint failed: ' + out);
  return out.trim();
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return (await res.json()) as T;
}

test.describe('dispatch fresh start after wipe (T4)', () => {
  test('after wipeBusinessData runs, dispatch board is empty and next order is XTT.MM-001', async ({ request }) => {
    test.setTimeout(90_000);
    // Pre-seed at least one driver+vehicle+pair+customer+warehouse+cargo_type
    // BEFORE the wipe so we can assert they survive.
    const preToken = await mintDispatcherToken();
    const preTs = Date.now();
    const preRand = Math.floor(Math.random() * 1e9).toString(36);
    const preDrv = await adminPost<{ operatorId: string; driverId: string }>(
      request, preToken, '/admin/drivers',
      { fullName: 'PRESERVE DRIVER T4 ' + String(preTs) + '-' + preRand, phone: '08' + String(preTs).slice(-8), password: 'e2e-pass-1234' }, // pragma: allowlist secret
    );
    const preVeh = await adminPost<{ id: string }>(request, preToken, '/reference/vehicles', { name: 'PRESERVE-VEH-' + preRand });
    await adminPost(request, preToken, '/admin/driver-vehicle-assignments', { driverId: preDrv.driverId, vehicleId: preVeh.id });
    await adminPost(request, preToken, '/reference/customers', { name: 'PRESERVE-CUST-' + preRand });
    await adminPost(request, preToken, '/reference/warehouses', { name: 'PRESERVE-WH-' + preRand });
    await adminPost(request, preToken, '/reference/cargo-types', { name: 'PRESERVE-CARGO-' + preRand });

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

    // Run the wipe via the wipeBusinessData() module imported from the built
    // api code inside the container. Production-equivalent path: this is the
    // exact same code an operator would run via the CLI script.
    const wipeOut = dockerExecNode(
      'fleet-pilot-api-1',
      'import(' + JSON.stringify('./dist/maintenance/wipe-business-data.js') + ').then(m=>m.wipeBusinessData(require(' + JSON.stringify('drizzle-orm/node-postgres') + ').drizzle(new (require(' + JSON.stringify('pg') + ').Pool)({connectionString:process.env.DATABASE_URL})))).then(()=>process.stdout.write(' + JSON.stringify('WIPE-OK') + ')).catch(e=>{console.error(e);process.exit(1)})',
    );
    expect(wipeOut).toContain('WIPE-OK');

    // INVARIANT 1 (preservation): reference/master data MUST survive the wipe.
    // This is the production-critical invariant the user flagged: dispatchers
    // must not lose their driver list, vehicle plates, customer names,
    // warehouse names, cargo types, or driver-vehicle pairings.
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

    // DB-level invariants after wipe.
    const sq = String.fromCharCode(39);
    const orders = dockerPsql('SELECT COUNT(*) FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
    expect(orders).toBe('0');
    const roadRuns = dockerPsql('SELECT COUNT(*) FROM road_run WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
    expect(roadRuns).toBe('0');
    const projection = dockerPsql('SELECT COUNT(*) FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
    expect(projection).toBe('0');
    const sequences = dockerPsql('SELECT COUNT(*) FROM order_sequence WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
    expect(sequences).toBe('0');

    // Seed a driver+vehicle+assignment so we can create the first order.
    const token = await mintDispatcherToken();
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    const drv = await adminPost<{ operatorId: string; driverId: string }>(
      request, token, '/admin/drivers',
      { fullName: 'E2E DRIVER T4-FRESH ' + String(ts) + '-' + rand, phone: '09' + String(ts).slice(-8), password: 'e2e-pass-1234' }, // pragma: allowlist secret
    );
    const veh = await adminPost<{ id: string }>(request, token, '/reference/vehicles', { name: 'E2E-T4-FRESH-' + rand });
    await adminPost(request, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id });

    // First create after wipe MUST be XTT.MM-001.
    const created = await adminPost<{ externalRef: string }>(
      request, token, '/transport-orders',
      {
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id },
      },
    );
    expect(created.externalRef).toBe('XTT.' + currentMonth2() + '-001');
  });
});
