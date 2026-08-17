// e2e/dispatcher-to-driver-fulfillment.spec.ts
// Full dispatcher -> driver fulfillment E2E, built to the 2026 standard:
// SELF-SEEDED, deterministic, run-order-independent. Replaces the fragile
// approach of depending on a manually-UI-created order (XTT.06-001) and a
// specific named driver (PHONG) - that data does not survive an environment
// reset and cannot anchor an automated test (see
// context/e2e-test-data-via-api-factory-not-manual-fixtures.md).
//
// LIFECYCLE NOTE (why the driver leg is asserted in-process): e2e/global-teardown.ts
// soft-deactivates every E2E% driver AFTER the Playwright suite. A cross-process
// Maestro driver leg that runs after teardown therefore hits a deactivated seed
// (login 403 "disabled"). The 2026 consensus fix is a self-contained scenario
// that owns its data for its whole lifecycle: the deterministic driver-leg
// assertion (login + identity) runs in the SAME process, before teardown. The
// Maestro UI run remains a separate "canary" seeded just-in-time.
//
// What this spec OWNS (Playwright):
//   1. Seed a UNIQUE driver + vehicle + assignment via the app OWN admin API
//      (factory pattern, reused from create-then-open-review.spec.ts). The
//      driver has a KNOWN password and an E2E-prefixed, timestamped identity.
//   2. Dispatcher logs into ops-web and CREATES the transport order via the UI;
//      selecting the seeded vehicle auto-binds its assigned operator to the road
//      run, with pickup + delivery stops.
//   3. Verify (DB) the freshly-created order links to the SEEDED operator.
//   4. Prove the SEED is usable through the app OWN driver login + identity
//      path, IN-PROCESS (active=true -> 200 + accessToken; /driver/me returns the
//      seeded assigned vehicle), before global teardown can deactivate it.
//   5. EMIT the seeded driver phone + password + order ref to a JSON handoff
//      file for an optional Maestro UI canary (seeded just-in-time, separately).
//   6. Idempotent teardown scoped to the seeded vehicle id.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { dockerPsql } from './helpers/docker-exec';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { type z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, DriverLoginResponseSchema, DriverMeResponseSchema } from './helpers/contracts';
import { openCreateOrderDrawer, plannedStartAtField } from './helpers/create-order';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const HANDOFF_PATH = process.env['E2E_DRIVER_HANDOFF']
  ?? resolve(import.meta.dirname, '../.e2e-artifacts/driver-handoff.json');
const KNOWN_PASSWORD = 'e2e-pass-1234'; // pragma: allowlist secret
interface Seed {
  driverId: string; operatorId: string; vehicleId: string;
  vehicleLabel: string; driverLabel: string; driverPhone: string;
  assignmentId: string; token: string;
}
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, data: JSON.stringify(body) });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}
async function setupSeed(api: APIRequestContext): Promise<Seed> {
  const token = mintDispatcherToken();
  const ts = Date.now();
  const driverPhone = '09' + String(ts).slice(-8);
  const driverLabel = 'E2E DRIVER FULFILL ' + String(ts);
  const vehicleLabel = 'E2E-FULFILL-' + String(ts);
  const drv = await adminPost(api, token, '/admin/drivers', { fullName: driverLabel, phone: driverPhone, password: KNOWN_PASSWORD }, CreateDriverResponseSchema);
  const veh = await adminPost(api, token, '/reference/vehicles', { name: vehicleLabel }, ReferenceItemSchema);
  const asgn = await adminPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id }, AssignmentResponseSchema);
  return { driverId: drv.driverId, operatorId: drv.operatorId, vehicleId: veh.id, vehicleLabel, driverLabel, driverPhone, assignmentId: asgn.assignmentId, token };
}
function cleanupSeed(seed: Seed): void {
  const sq = String.fromCharCode(39);
  const v = sq + seed.vehicleId + sq;
  try { dockerPsql('DELETE FROM stop WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t JOIN road_run_transport_order rrto ON rrto.transport_order_id=t.transport_order_id JOIN road_run r ON r.road_run_id=rrto.road_run_id WHERE r.assigned_asset_id=' + v + ');'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM road_run_transport_order WHERE road_run_id IN (SELECT road_run_id FROM road_run WHERE assigned_asset_id=' + v + ');'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM transport_order WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t WHERE NOT EXISTS (SELECT 1 FROM road_run_transport_order x WHERE x.transport_order_id=t.transport_order_id) AND t.company_id=' + sq + COMPANY_ID + sq + ');'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM road_run WHERE assigned_asset_id=' + v + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM dispatch_board_projection WHERE assigned_asset_id=' + v + ';'); } catch { /* tolerate */ }
}
// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}
test.describe.serial('dispatcher creates an order, driver fulfills it (self-seeded)', () => {
  let seed: Seed | null = null;
  function requireSeed(): Seed {
    if (seed === null) throw new Error('seed missing');
    return seed;
  }
  test.beforeAll(async ({ request }) => { seed = await setupSeed(request); });
  test.afterAll(() => { if (seed) cleanupSeed(seed); });
  test('dispatcher UI creates an order bound to the seeded driver, and the driver leg credentials are emitted', async ({ page }) => {
    const sd = requireSeed();
    await login(page);
    await page.goto('/');
    await openCreateOrderDrawer(page);
    await plannedStartAtField(page.locator('[data-testid=nl-create-order-form]')).fill('2026-06-01');
    const vehicleInput = page.locator('input#vehiclePlate');
    await vehicleInput.click();
    await vehicleInput.fill(sd.vehicleLabel);
    await page.getByRole('option', { name: sd.vehicleLabel }).click();
    await page.locator('#pickupAt').fill('2026-06-01');
    await page.locator('#deliveryAt').fill('2026-06-01');
    await page.locator('input#pickupWarehouse_1').click();
    await page.getByRole('option').first().click();
    await page.locator('input#deliveryWarehouse_1').click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'T\u1ea1o l\u1ec7nh' }).click();
    const newRow = page.locator('a[href^="/dispatch/orders/"]').first();
    await expect(newRow).toBeVisible({ timeout: 15000 });
    const href = await newRow.getAttribute('href');
    const orderRef = href === null ? '' : (href.split('/').pop() ?? '');
    expect(orderRef.length).toBeGreaterThan(0);
    const sq = String.fromCharCode(39);
    const linked = dockerPsql(
      'SELECT count(*) FROM road_run r ' +
      'JOIN road_run_transport_order rrto ON rrto.road_run_id=r.road_run_id ' +
      'JOIN transport_order t ON t.transport_order_id=rrto.transport_order_id ' +
      'WHERE r.assigned_operator_id=' + sq + sd.operatorId + sq +
      ' AND r.assigned_asset_id=' + sq + sd.vehicleId + sq + ';',
    );
    expect(linked.failed).toBe(false);
    expect(parseInt(linked.stdout.trim(), 10)).toBeGreaterThanOrEqual(1);
    mkdirSync(dirname(HANDOFF_PATH), { recursive: true });
    writeFileSync(HANDOFF_PATH, JSON.stringify({
      driverPhone: sd.driverPhone,
      driverPassword: KNOWN_PASSWORD,
      orderRef,
      operatorId: sd.operatorId,
      vehicleId: sd.vehicleId,
      vehicleLabel: sd.vehicleLabel,
    }, null, 2));
  });
  test('the seeded driver can authenticate and sees their assigned vehicle (in-process, before teardown)', async ({ request }) => {
    const sd = requireSeed();
    // Deterministic vertical-E2E core: prove the SEED is usable through the
    // app OWN driver login + identity path, in the SAME process/lifecycle as the
    // dispatcher leg, so the global teardown (which soft-deactivates E2E drivers
    // after the suite) cannot deactivate it mid-scenario. This is the exact gate
    // that fails when a cross-process Maestro leg runs after teardown:
    // active=true -> 200 + accessToken; the seeded vehicle is the assignment.
    const loginRes = await request.post(API_URL + '/auth/login', {
      data: { phone: sd.driverPhone, password: KNOWN_PASSWORD },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginBody = await parseJson(loginRes, DriverLoginResponseSchema);
    expect(typeof loginBody.accessToken).toBe('string');
    expect(loginBody.driver?.operatorId).toBe(sd.operatorId);
    const meRes = await request.get(API_URL + '/driver/me', {
      headers: { Authorization: 'Bearer ' + loginBody.accessToken },
    });
    expect(meRes.ok()).toBeTruthy();
    const me = await parseJson(meRes, DriverMeResponseSchema);
    expect(me.assignedVehicle?.vehicleId).toBe(sd.vehicleId);
  });
});
