// e2e/dispatch-order-protection-chain.spec.ts
//
// End-to-end verification of the 2026 invariant: every transport_order is
// created with a roadRun that binds an active driver-vehicle pair.
// Exercises the full protection chain across layers 1..5 against the live
// docker-compose stack (postgres + api + ops-web + mock-oauth2).
//
//   Layer 1 (CreateOrderForm): dropdowns filter to paired-only entities;
//     selecting a vehicle auto-fills the hidden assignedAssetId UUID.
//   Layer 1+2 happy path: dispatcher submits the form -> server action ->
//     api POST /transport-orders -> service writes road_run + transport_order
//     -> postgres row visible via psql.
//   Layer 3 (API DTO): CreateTransportOrderSchema rejects body whose
//     roadRun is missing assignedAssetId.
//   Layer 4 (TransportOrdersService): pair guard rejects revoked
//     driver_vehicle_assignment rows.
//   Layer 5 (DB): road_run.assigned_operator_id NOT NULL constraint
//     rejects direct INSERT with NULL operator (last line of defense).
//
// No-leak contract (2026-Q2): protection-chain helpers must not leak
// active driver_vehicle_assignment rows or visible test vehicles/drivers
// into the dispatcher live /reference data. The dispatch form is a real
// admin surface; leaked E2E pairs would appear as selectable options on
// every dispatcher screen, polluting the production-like UX. Captured
// baselines in beforeAll; asserted in afterAll; per-test teardown lives
// in afterEach via a shared seededPairs stack populated by setupPair.
//
// Test isolation: each test mints its own dispatcher token via /fleet/token
// and provisions a fresh driver+vehicle+assignment with timestamp-suffixed
// unique names, so parallel workers do not collide.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql, dockerExecNode } from './helpers/docker-exec';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const OIDC_TOKEN_URL = process.env.E2E_OIDC_TOKEN_URL ?? 'http://localhost:8080/fleet/token';
const POSTGRES_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'fleet-pilot-postgres-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
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
interface SeededPair {
  driverId: string;
  operatorId: string;
  vehicleId: string;
  vehicleLabel: string;
  driverLabel: string;
  assignmentId: string;
  token: string;
}
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) {
    throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  }
  return (await res.json()) as T;
}
async function adminDelete(api: APIRequestContext, token: string, path: string, body: unknown): Promise<void> {
  const res = await api.delete(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) {
    throw new Error('DELETE ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  }
}
async function listLabels(api: APIRequestContext, token: string, path: string): Promise<readonly string[]> {
  const res = await api.get(API_URL + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok()) throw new Error('GET ' + path + ' failed ' + String(res.status()));
  const json = (await res.json()) as { items: readonly { label: string }[] };
  return json.items.map((i) => i.label).sort();
}
async function setupPair(api: APIRequestContext, suffix: string): Promise<SeededPair> {
  const token = await mintDispatcherToken();
  const ts = Date.now();
  const phone = '09' + String(ts).slice(-8);
  const driverLabel = 'E2E DRIVER ' + suffix + ' ' + String(ts);
  const vehicleLabel = 'E2E-' + suffix + '-' + String(ts);
  const drv = await adminPost<{ driverId: string; operatorId: string }>(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
  );
  const veh = await adminPost<{ id: string; label: string }>(
    api, token, '/reference/vehicles', { name: vehicleLabel },
  );
  const asgn = await adminPost<{ assignmentId: string }>(
    api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
  );
  return {
    driverId: drv.driverId,
    operatorId: drv.operatorId,
    vehicleId: veh.id,
    vehicleLabel,
    driverLabel,
    assignmentId: asgn.assignmentId,
    token,
  };
}
async function loginAsDispatcher(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill('dispatcher');
  await page.getByLabel(/mật khẩu|password/i).fill('any-password');
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
test.describe.configure({ mode: 'serial' });
test.describe('dispatch order protection chain (Layers 1-5)', () => {
  // 2026-Q2 no-leak contract. Self-scoped assertion: track every
  // (vehicleLabel, driverLabel) the spec seeds via setupPair; afterAll
  // asserts none of THOSE specific labels remain in dispatcher reference
  // data. This is parallel-safe — unlike the baseline-equality pattern,
  // which is fragile when sibling E2E specs are mid-test in other workers.
  const seededPairs: SeededPair[] = [];
  const seededVehicleLabels = new Set<string>();
  const seededDriverLabels = new Set<string>();
  // 2026 best practice: tests that create transport_order rows via UI
  // must also clean up THOSE rows. afterEach pops + DELETEs; afterAll
  // asserts no-leak. Prevents Lệnh điều xe table pollution by orphan
  // planned rows whose driver/vehicle have been cleaned up.
  const seededOrderRefs: string[] = [];
  function trackPair(pair: SeededPair): void {
    seededPairs.push(pair);
    seededVehicleLabels.add(pair.vehicleLabel);
    seededDriverLabels.add(pair.driverLabel);
  }
  test.afterEach(async ({ request }) => {
    // Delete order rows FIRST so foreign-key dependencies on operators/
    // vehicles are released before the pair cleanup runs.
    const sq = String.fromCharCode(39);
    while (seededOrderRefs.length > 0) {
      const ref = seededOrderRefs.pop();
      if (!ref) continue;
      // Delete transport_order + its road_run + outbox rows so the
      // dispatch_board projection does not replay stale state on the
      // next parallel worker's render of /.
      const txIdSql = 'SELECT transport_order_id FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref=' + sq + ref + sq + ';';
      const txIdRes = dockerPsql(txIdSql);
      const txId = txIdRes.stdout.trim();
      if (txId.length > 0) {
        const rrIdSql = 'SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';';
        const rrIds = dockerPsql(rrIdSql).stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
        try { dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
        try { dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
        for (const rrId of rrIds) {
          try { dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ }
        }
      }
      try { dockerPsql('DELETE FROM outbox WHERE company_id=' + sq + COMPANY_ID + sq +
        " AND payload->>'externalRef'=" + sq + ref + sq + ';'); } catch { /* tolerate */ }
      // Also clear the dispatch_board_projection so the read model on /
      // does not show duplicate stale rows for this ref on next render.
      try { dockerPsql('DELETE FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq +
        " AND external_ref=" + sq + ref + sq + ';'); } catch { /* tolerate */ }
      const delSql = 'DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref=' + sq + ref + sq + ';';
      try { dockerPsql(delSql); } catch { /* tolerate */ }
    }
    while (seededPairs.length > 0) {
      const pair = seededPairs.pop();
      if (!pair) continue;
      try {
        await adminDelete(request, pair.token, '/admin/driver-vehicle-assignments/' + pair.assignmentId, { reason: 'e2e-afterEach' });
      } catch { /* already revoked by the test body (e.g. Layer 4) */ }
      try {
        const r = await request.delete(API_URL + '/reference/vehicles/' + pair.vehicleId, {
          headers: { Authorization: 'Bearer ' + pair.token },
        });
        if (!r.ok()) { /* tolerate idempotent failures */ }
      } catch { /* tolerate idempotent failures */ }
      try {
        const r = await request.delete(API_URL + '/admin/drivers/' + pair.driverId, {
          headers: { Authorization: 'Bearer ' + pair.token },
        });
        if (!r.ok()) { /* tolerate idempotent failures */ }
      } catch { /* tolerate idempotent failures */ }
    }
  });
  test.afterAll(async ({ request }) => {
    const token = await mintDispatcherToken();
    const vehiclesAfter = await listLabels(request, token, '/reference/vehicles');
    const driversAfter = await listLabels(request, token, '/reference/drivers');
    const leakedVehicles = vehiclesAfter.filter((l) => seededVehicleLabels.has(l));
    const leakedDrivers = driversAfter.filter((l) => seededDriverLabels.has(l));
    expect(leakedVehicles).toEqual([]);
    expect(leakedDrivers).toEqual([]);
    if (seededOrderRefs.length > 0) {
      const sq = String.fromCharCode(39);
      const inList = seededOrderRefs.map((r) => sq + r + sq).join(',');
      const sql = 'SELECT external_ref FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref IN (' + inList + ');';
      const r = dockerPsql(sql);
      const leakedOrders = r.stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
      expect(leakedOrders).toEqual([]);
    }
  });
  test('Layer 1: paired-only dropdown filtering + hidden assignedAssetId auto-fill', async ({ page, request }) => {
    const pair = await setupPair(request, 'L1');
    trackPair(pair);
    const unpairedVehicleLabel = 'E2E-UNPAIRED-' + String(Date.now());
    const unpairedVeh = await adminPost<{ id: string; label: string }>(
      request, pair.token, '/reference/vehicles', { name: unpairedVehicleLabel },
    );
    await loginAsDispatcher(page);
    await page.goto('/');
    const vehicleInput = page.locator('input#vehiclePlate');
    await vehicleInput.click();
    await vehicleInput.fill('E2E-');
    await expect(page.getByRole('option', { name: pair.vehicleLabel })).toBeVisible();
    await expect(page.getByRole('option', { name: unpairedVehicleLabel })).toHaveCount(0);
    await page.getByRole('option', { name: pair.vehicleLabel }).click();
    await expect(page.locator('input[name=' + JSON.stringify('assignedAssetId') + ']')).toHaveValue(pair.vehicleId);
    // The unpaired bare vehicle created here is not part of a SeededPair,
    // so afterEach would not clean it. Soft-delete it directly.
    try {
      await request.delete(API_URL + '/reference/vehicles/' + unpairedVeh.id, {
        headers: { Authorization: 'Bearer ' + pair.token },
      });
    } catch { /* tolerate */ }
  });
  test('Layer 1+2 happy path: form to action to API to service to DB row', async ({ page, request }) => {
    const pair = await setupPair(request, 'L2');
    trackPair(pair);
    const sq = String.fromCharCode(39);
    const beforeMaxSql =
      'SELECT COALESCE(MAX((substring(external_ref FROM ' + sq + '^XTT\\.\\d{2}-(\\d+)$' + sq + '))::int), 0) ' +
      'FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND external_ref ~ ' + sq + '^XTT\\.(0[1-9]|1[0-2])-\\d+$' + sq + ';';
    const beforeMax = parseInt(dockerPsql(beforeMaxSql).stdout.trim(), 10);
    await loginAsDispatcher(page);
    await page.goto('/');
    await page.locator('#plannedStartAt').fill('2026-06-01T08:00');
    const vehicleInput = page.locator('input#vehiclePlate');
    await vehicleInput.click();
    await vehicleInput.fill(pair.vehicleLabel);
    await page.getByRole('option', { name: pair.vehicleLabel }).click();
    await page.locator('#pickupAt').fill('2026-06-01T09:00');
    await page.locator('#deliveryAt').fill('2026-06-01T18:00');
    await page.locator('input#pickupWarehouse_1').click();
    await page.getByRole('option').first().click();
    await page.locator('input#deliveryWarehouse_1').click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Tạo lệnh' }).click();
    const findSql =
      'SELECT external_ref FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' ' +
      'AND external_ref ~ ' + sq + '^XTT\\.(0[1-9]|1[0-2])-\\d+$' + sq + ' ' +
      'AND (substring(external_ref FROM ' + sq + '^XTT\\.\\d{2}-(\\d+)$' + sq + '))::int > ' + String(beforeMax) +
      ' ORDER BY created_at DESC LIMIT 1;';
    let createdRef = '';
    for (let i = 0; i < 30; i++) {
      const r = dockerPsql(findSql);
      const v = r.stdout.trim();
      if (v.length > 0) { createdRef = v; break; }
      await page.waitForTimeout(500);
    }
    // No-leak: push BEFORE assertion so the order is cleaned up even
    // when the assertion fails (e.g. flaky polling under parallel workers).
    if (createdRef.length > 0) seededOrderRefs.push(createdRef);
    expect(createdRef).toMatch(/^XTT\.(0[1-9]|1[0-2])-\d{3,}$/);
  });
  test('Layer 3: API DTO rejects body missing roadRun.assignedAssetId', async ({ request }) => {
    const pair = await setupPair(request, 'L3');
    trackPair(pair);
    const res = await request.post(API_URL + '/transport-orders', {
      headers: { Authorization: 'Bearer ' + pair.token, 'Content-Type': 'application/json' },
      data: {
        externalRef: 'E2E-L3-' + String(Date.now()),
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: pair.operatorId },
      },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(600);
  });
  test('Layer 4: service rejects revoked driver_vehicle_assignment', async ({ request }) => {
    const pair = await setupPair(request, 'L4');
    trackPair(pair);
    await adminDelete(request, pair.token, '/admin/driver-vehicle-assignments/' + pair.assignmentId, { reason: 'e2e-revoke' });
    const res = await request.post(API_URL + '/transport-orders', {
      headers: { Authorization: 'Bearer ' + pair.token, 'Content-Type': 'application/json' },
      data: {
        externalRef: 'E2E-L4-' + String(Date.now()),
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          assignedOperatorId: pair.operatorId,
          assignedAssetId: pair.vehicleId,
        },
      },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
  test('Layer 5: DB NOT NULL constraint rejects road_run with NULL assigned_operator_id', async () => {
    const fakeVehicleUuid = '00000000-0000-0000-0000-0000000000ff';
    const sql =
      'INSERT INTO road_run ' +
      '(company_id, business_unit_id, depot_id, legal_entity_id, ' +
      'assigned_operator_id, assigned_asset_id) VALUES (' +
      sq39() + COMPANY_ID + sq39() + ',' + sq39() + COMPANY_ID + sq39() + ',' + sq39() + COMPANY_ID + sq39() + ',' + sq39() + COMPANY_ID + sq39() + ',' +
      ' NULL, ' + sq39() + fakeVehicleUuid + sq39() + ');';
    const result = dockerPsql(sql);
    expect(result.failed).toBe(true);
    expect(result.stderr + result.stdout).toMatch(/null value in column .assigned_operator_id.|not-null constraint|23502/);
  });
});
function sq39(): string { return String.fromCharCode(39); }
