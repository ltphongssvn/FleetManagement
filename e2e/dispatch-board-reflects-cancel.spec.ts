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
import { loginAs, mintDispatcherToken } from './helpers/auth';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const DOLLAR = String.fromCharCode(36);
const BOARD_URL = new RegExp('/' + DOLLAR);

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

// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
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
    // Post-T(Khách hàng-column): the board REPLACED the Trạng thái column with
    // Khách hàng. Cancelled orders REMAIN in dispatch_board_projection by design
    // (the projection upserts state='cancelled'; only a tombstone deletes — see
    // transport-orders.cancel.service.projection-event.integration.test.ts).
    // So the dispatcher must still SEE the cancellation: the row carries a
    // cancelled marker testid + the localized 'Đã hủy' badge, even though the
    // standalone Trạng thái column is gone. Projection is eventually consistent,
    // so poll the marker.
    const cancelledMarker = page.getByTestId('dispatch-board-row-cancelled-' + order.externalRef);
    await expect(cancelledMarker).toBeVisible({ timeout: 15000 });
    await expect(cancelledMarker).toContainText('Đã hủy');
  });
});
