// e2e/create-then-open-review.spec.ts
// T6 L0 acceptance (RED first): after the dispatcher clicks Tạo lệnh, a new
// row appears in the Lệnh điều xe table; clicking that row's link must open
// the review view (Chi tiết đơn vận chuyển) on the FIRST click — WITHOUT a
// manual browser refresh.
//
// Reproduces the reported defect: the optimistic row's <Link> RSC payload is
// never prefetched (the row did not exist at first board render), so the
// first click stalls until a hard reload repopulates the Router Cache.
//
// Business invariant: the just-created order's review view opens on the first
// click; the dispatcher never has to refresh the board manually.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql, dockerExecNode } from './helpers/docker-exec';
const OPS_USER = process.env['E2E_OPS_USERNAME'] ?? 'dieuxe';
const OPS_PASS = process.env['E2E_OPS_PASSWORD'] ?? 'pw';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
function mintDispatcherToken(): string {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = dockerExecNode('fleet-pilot-api-1', script);
  if (!out.includes('.')) throw new Error('Token mint failed: ' + out);
  return out.trim();
}
interface Pair { driverId: string; operatorId: string; vehicleId: string; vehicleLabel: string; driverLabel: string; assignmentId: string; token: string }
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, data: JSON.stringify(body) });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return (await res.json()) as T;
}
async function setupPair(api: APIRequestContext): Promise<Pair> {
  const token = mintDispatcherToken();
  const ts = Date.now();
  const driverLabel = 'E2E DRIVER T6-CREATE ' + String(ts);
  const vehicleLabel = 'E2E-T6-CREATE-' + String(ts);
  const drv = await adminPost<{ driverId: string; operatorId: string }>(api, token, '/admin/drivers', { fullName: driverLabel, phone: '09' + String(ts).slice(-8), password: 'e2e-pass-1234' }); // pragma: allowlist secret
  const veh = await adminPost<{ id: string; label: string }>(api, token, '/reference/vehicles', { name: vehicleLabel });
  const asgn = await adminPost<{ assignmentId: string }>(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id });
  return { driverId: drv.driverId, operatorId: drv.operatorId, vehicleId: veh.id, vehicleLabel, driverLabel, assignmentId: asgn.assignmentId, token };
}
function cleanupPair(pair: Pair, _api: APIRequestContext): Promise<void> {
  const sq = String.fromCharCode(39);
  try { dockerPsql('DELETE FROM stop WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t JOIN road_run_transport_order rrto ON rrto.transport_order_id=t.transport_order_id JOIN road_run r ON r.road_run_id=rrto.road_run_id WHERE r.assigned_asset_id=' + sq + pair.vehicleId + sq + ');'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM road_run_transport_order WHERE road_run_id IN (SELECT road_run_id FROM road_run WHERE assigned_asset_id=' + sq + pair.vehicleId + sq + ');'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM transport_order WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t WHERE NOT EXISTS (SELECT 1 FROM road_run_transport_order x WHERE x.transport_order_id=t.transport_order_id) AND t.company_id=' + sq + COMPANY_ID + sq + ');'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM road_run WHERE assigned_asset_id=' + sq + pair.vehicleId + sq + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM dispatch_board_projection WHERE assigned_asset_id=' + sq + pair.vehicleId + sq + ';'); } catch { /* tolerate */ }
  return Promise.resolve();
}
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill(OPS_USER);
  await page.getByLabel(/mật khẩu|password/i).fill(OPS_PASS);
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dispatch|\/$/, { timeout: 10000 });
}
test.describe.serial('create order then open review on first click (T6)', () => {
  let pair: Pair | null = null;
  test.beforeAll(async ({ request }) => { pair = await setupPair(request); });
  test.afterAll(async ({ request }) => { if (pair) await cleanupPair(pair, request); });
  test('clicking the newly created row opens the review view without a manual refresh', async ({ page }) => {
    if (!pair) throw new Error('pair missing');
    await login(page);
    await page.goto('/');
    await expect(page.locator('[data-testid=create-order-form][data-hydrated=true]')).toBeVisible({ timeout: 15_000 });
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
    const newRow = page.locator('a[href^="/dispatch/orders/"]').first();
    await expect(newRow).toBeVisible({ timeout: 15000 });
    // First click — no manual reload. The review view must open.
    await newRow.click();
    await expect(page).toHaveURL(/\/dispatch\/orders\/.+/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /chi tiết|order review|đơn vận chuyển/i })).toBeVisible({ timeout: 10000 });
  });
});
