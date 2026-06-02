// e2e/dispatch-board-reflects-cancel.spec.ts
// T5 acceptance: cancelling a transport order from the review view must
// (a) navigate the dispatcher back to the Bảng điều phối board, and
// (b) update the board row's Trạng thái cell to 'cancelled' so the
// dispatcher sees a consistent view across the cancel boundary.
//
// 2026-Q2 self-seeding rewrite: the prior version scraped the board for
// any non-terminal row, which became flaky under the new defense-in-depth
// cascade (soft-deleting a vehicle/driver auto-cancels its open orders).
// A parallel sibling spec's afterEach could auto-cancel the row this
// spec picked, racing the cancel POST. The fix: each run seeds its own
// dedicated driver-vehicle pair + transport_order via the API, then
// exercises the UI cancel flow against THAT order only. Fully self-
// contained, parallel-safe, and immune to cascade timing.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerExecNode } from './helpers/docker-exec';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const DOLLAR = String.fromCharCode(36);
const BOARD_URL = new RegExp('/' + DOLLAR);

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

async function apiPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return (await res.json()) as T;
}

interface SeededOrder {
  externalRef: string;
  transportOrderId: string;
  vehicleId: string;
  driverId: string;
  operatorId: string;
}

async function seedOrder(api: APIRequestContext): Promise<SeededOrder> {
  const token = mintDispatcherToken();
  const ts = String(Date.now());
  const phone = '09' + ts.slice(-8);
  const drv = await apiPost<{ driverId: string; operatorId: string }>(
    api, token, '/admin/drivers',
    { fullName: 'E2E-T5-CANCEL-' + ts, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
  );
  const veh = await apiPost<{ id: string }>(
    api, token, '/reference/vehicles', { name: 'E2E-T5-CANCEL-' + ts },
  );
  await apiPost(api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
  );
  const order = await apiPost<{ transportOrderId: string; externalRef: string }>(
    api, token, '/transport-orders',
    {
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id },
    },
  );
  return {
    externalRef: order.externalRef,
    transportOrderId: order.transportOrderId,
    vehicleId: veh.id,
    driverId: drv.driverId,
    operatorId: drv.operatorId,
  };
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill('dispatcher');
  await page.getByLabel(/mật khẩu|password/i).fill('any-password');
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

const seededOrders: SeededOrder[] = [];

async function cleanupOrder(api: APIRequestContext, o: SeededOrder): Promise<void> {
  // Soft-deleting either endpoint cascades: revokes assignment AND cancels
  // any non-terminal transport_order. We soft-delete the vehicle (sufficient
  // to clean both the pair and the order in one call).
  const token = mintDispatcherToken();
  await api.delete(API_URL + '/reference/vehicles/' + o.vehicleId, {
    headers: { Authorization: 'Bearer ' + token },
  });
}

test.describe('dispatch board reflects cancellation (T5)', () => {
  test.afterEach(async ({ request }) => {
    while (seededOrders.length > 0) {
      const o = seededOrders.pop();
      if (o) await cleanupOrder(request, o);
    }
  });
  test('cancelling from the review view navigates back to the board and the row shows cancelled', async ({ page, request }) => {
    // Seed our OWN order (parallel-safe, immune to cascade from sibling specs).
    const order = await seedOrder(request);
    seededOrders.push(order);
    await login(page);
    // Open the review page for OUR seeded order.
    await page.goto('/dispatch/orders/' + order.externalRef);
    await expect(page.getByRole('heading', { name: /chi tiết đơn vận chuyển/i })).toBeVisible();
    // Sanity-check the state we are about to flip.
    const stateEl = page.getByTestId('order-review-state');
    const currentState = (await stateEl.textContent())?.trim() ?? '';
    expect(currentState).not.toBe('cancelled');
    expect(currentState).not.toBe('completed');
    // Submit the cancel.
    await page.getByTestId('order-cancel-open').click();
    await page.getByTestId('order-cancel-reason').selectOption('customer_request');
    await page.getByTestId('order-cancel-submit').click();
    // After a successful cancel the dispatcher should land on the board.
    await expect(page).toHaveURL(BOARD_URL, { timeout: 10000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible();
    // The cancelled row's Trạng thái cell must now show 'cancelled'.
    // Use .first() to bypass strict-mode if the dispatch_board_projection
    // contains stale rows for the same ref (e.g. residue from a prior CI run
    // that crashed before its afterEach cleanup ran).
    const rowLink = page.getByTestId('dispatch-board-row-' + order.externalRef).first();
    await expect(rowLink).toBeVisible({ timeout: 10000 });
    const row = page.locator('tr', { has: rowLink }).first();
    await expect(row).toContainText('cancelled', { timeout: 10000 });
  });
});
