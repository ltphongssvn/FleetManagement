// e2e/dispatch-board-no-rerender-loop.spec.ts
// REGRESSION L0 (2026): after clicking Tạo lệnh, the Lệnh điều xe board must
// NOT enter a continuous RSC re-render loop (DevTools ?_rsc= storm ->
// ERR_INSUFFICIENT_RESOURCES; server log [loadReferences] repeating endlessly).
//
// Business invariant: creating an order settles the board to a stable state;
// the page stops re-fetching once the optimistic row shows and the projection
// reconciles. Discriminator: count server-side '/' renders (the per-render
// [loadReferences] /reference/drivers log line) in a quiet window AFTER the
// success banner. Converged board: bounded. Looping board: unbounded.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerExecNode } from './helpers/docker-exec';
import { execSync } from 'node:child_process';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const OPS_USER = process.env['E2E_OPS_USERNAME'] ?? 'dieuxe';
const OPS_PASS = process.env['E2E_OPS_PASSWORD'] ?? 'pw';

function opsWebRenderCount(): number {
  const out = execSync(
    'docker logs fleet-pilot-ops-web-1 2>&1 | grep -c ' + JSON.stringify('/reference/drivers ->') + ' || true',
    { encoding: 'utf8' },
  );
  return parseInt(out.trim(), 10) || 0;
}

async function mintToken(): Promise<string> {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = dockerExecNode('fleet-pilot-api-1', script);
  if (out.includes('.') === false) throw new Error('Token mint failed: ' + out);
  return out.trim();
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (res.ok() === false) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return (await res.json()) as T;
}

interface Pair { driverId: string; vehicleId: string; vehicleLabel: string; assignmentId: string; token: string }

async function seedPair(api: APIRequestContext): Promise<Pair> {
  const token = await mintToken();
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  const phone = '09' + String(Date.now()).slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const drv = await adminPost<{ driverId: string }>(api, token, '/admin/drivers', { fullName: 'E2E DRIVER NOLOOP ' + rand, phone, password: 'e2e-pass-1234' }); // pragma: allowlist secret
  const veh = await adminPost<{ id: string }>(api, token, '/reference/vehicles', { name: 'E2E-NL-' + rand });
  const asgn = await adminPost<{ assignmentId: string }>(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id });
  return { driverId: drv.driverId, vehicleId: veh.id, vehicleLabel: 'E2E-NL-' + rand, assignmentId: asgn.assignmentId, token };
}

async function cleanupPair(api: APIRequestContext, p: Pair): Promise<void> {
  try { await api.delete(API_URL + '/admin/driver-vehicle-assignments/' + p.assignmentId, { headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, data: JSON.stringify({ reason: 'e2e' }) }); } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/reference/vehicles/' + p.vehicleId, { headers: { Authorization: 'Bearer ' + p.token } }); } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/admin/drivers/' + p.driverId, { headers: { Authorization: 'Bearer ' + p.token } }); } catch { /* tolerate */ }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill(OPS_USER);
  await page.getByLabel(/mật khẩu|password/i).fill(OPS_PASS);
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await expect(page).toHaveURL(/[/]dispatch|[/]$/, { timeout: 10_000 });
}

test.describe('dispatch board does not enter an RSC re-render loop after create', () => {
  let pair: Pair | null = null;
  test.beforeAll(async ({ request }) => { pair = await seedPair(request); });
  test.afterAll(async ({ request }) => { if (pair) await cleanupPair(request, pair); });

  test('board converges with bounded re-renders after Tạo lệnh', async ({ page }) => {
    if (pair === null) throw new Error('pair not seeded');
    await login(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible();
    await expect(page.locator('[data-testid=create-order-form][data-hydrated=true]')).toBeVisible({ timeout: 15_000 });

    const now = new Date(Date.now() + 3600_000).toISOString().slice(0, 16);
    await page.locator('#plannedStartAt').fill(now);
    const v = page.locator('input#vehiclePlate');
    await v.click(); await v.fill(pair.vehicleLabel);
    await page.getByRole('option', { name: pair.vehicleLabel }).click();
    await page.locator('#pickupAt').fill(now);
    await page.locator('#deliveryAt').fill(now);
    await page.locator('input#pickupWarehouse_1').click();
    await page.getByRole('option').first().click();
    await page.locator('input#deliveryWarehouse_1').click();
    await page.getByRole('option').first().click();

    await page.getByRole('button', { name: 'Tạo lệnh' }).click();
    const banner = page.getByRole('status').filter({ hasText: /XTT[.]/ });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    await page.waitForTimeout(1500);
    const before = opsWebRenderCount();
    await page.waitForTimeout(4000);
    const after = opsWebRenderCount();
    const delta = after - before;
    expect(delta, 'board kept re-rendering / (RSC loop) during a quiet 4s window; delta=' + String(delta)).toBeLessThanOrEqual(5);
  });
});
