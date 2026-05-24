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
// Test isolation: each test mints its own dispatcher token via /fleet/token
// and provisions a fresh driver+vehicle+assignment with timestamp-suffixed
// unique names, so parallel workers do not collide.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const OIDC_TOKEN_URL = process.env.E2E_OIDC_TOKEN_URL ?? 'http://localhost:8080/fleet/token';
const POSTGRES_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'fleet-pilot-postgres-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';

async function mintDispatcherToken(): Promise<string> {
  // The API validates OIDC tokens against issuer 'http://mock-oauth2:8080/fleet'
  // (the docker-internal hostname). Tokens minted from the host's localhost:8080
  // get iss='http://localhost:8080/fleet' and are rejected. Exec the token
  // request inside the api container so the issuer in the response matches.
  const script =
    "fetch('http://mock-oauth2:8080/fleet/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret'})" +
    ".then(r=>r.json()).then(j=>process.stdout.write(j.access_token))";
  const out = execSync("docker exec fleet-pilot-api-1 node -e \"" + script + "\"", { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
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

interface PsqlResult { stdout: string; stderr: string; failed: boolean }

function dockerPsql(sql: string): PsqlResult {
  // Run psql inside the running postgres container. Pass SQL via stdin so
  // we don't have to shell-quote single quotes; psql reads from stdin by
  // default when no -c is provided.
  const cmd = 'docker exec -i ' + POSTGRES_CONTAINER + ' psql -U fleet -d fleet -tA -v ON_ERROR_STOP=1';
  try {
    const stdout = execSync(cmd, { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    return { stdout, stderr: '', failed: false };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    return {
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: (err.stderr ? err.stderr.toString() : '') + (err.message ?? ''),
      failed: true,
    };
  }
}

test.describe.configure({ mode: 'serial' });
test.describe('dispatch order protection chain (Layers 1-5)', () => {
  test('Layer 1: paired-only dropdown filtering + hidden assignedAssetId auto-fill', async ({ page, request }) => {
    const pair = await setupPair(request, 'L1');
    const unpairedVehicleLabel = 'E2E-UNPAIRED-' + String(Date.now());
    await adminPost(request, pair.token, '/reference/vehicles', { name: unpairedVehicleLabel });

    await loginAsDispatcher(page);
    await page.goto('/');

    const vehicleInput = page.locator('input#vehiclePlate');
    await vehicleInput.click();
    await vehicleInput.fill('E2E-');

    await expect(page.getByRole('option', { name: pair.vehicleLabel })).toBeVisible();
    await expect(page.getByRole('option', { name: unpairedVehicleLabel })).toHaveCount(0);

    await page.getByRole('option', { name: pair.vehicleLabel }).click();
    await expect(page.locator('input[name="assignedAssetId"]')).toHaveValue(pair.vehicleId);
  });

  test('Layer 1+2 happy path: form to action to API to service to DB row', async ({ page, request }) => {
    const pair = await setupPair(request, 'L2');
    const sq = String.fromCharCode(39);
    const beforeMaxSql =
      'SELECT COALESCE(MAX((substring(external_ref FROM ' + sq + '^XT\\.(\\d+)$' + sq + '))::int), 0) ' +
      'FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND external_ref ~ ' + sq + '^XT\\.\\d+$' + sq + ';';
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
    // T3: external_ref is server-assigned (XT.NNN). Poll DB for a new row
    // whose XT sequence exceeds the pre-submit max.
    const findSql =
      'SELECT external_ref FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' ' +
      'AND external_ref ~ ' + sq + '^XT\\.\\d+$' + sq + ' ' +
      'AND (substring(external_ref FROM ' + sq + '^XT\\.(\\d+)$' + sq + '))::int > ' + String(beforeMax) +
      ' ORDER BY created_at DESC LIMIT 1;';
    let createdRef = '';
    for (let i = 0; i < 30; i++) {
      const r = dockerPsql(findSql);
      const v = r.stdout.trim();
      if (v.length > 0) { createdRef = v; break; }
      await page.waitForTimeout(500);
    }
    expect(createdRef).toMatch(/^XT\.\d{4,}$/);
  });

  test('Layer 3: API DTO rejects body missing roadRun.assignedAssetId', async ({ request }) => {
    const pair = await setupPair(request, 'L3');
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
      "'" + COMPANY_ID + "','" + COMPANY_ID + "','" + COMPANY_ID + "','" + COMPANY_ID + "'," +
      " NULL, '" + fakeVehicleUuid + "');";
    const result = dockerPsql(sql);
    expect(result.failed).toBe(true);
    expect(result.stderr + result.stdout).toMatch(/null value in column .assigned_operator_id.|not-null constraint|23502/);
  });
});
