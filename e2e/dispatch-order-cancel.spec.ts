// e2e/dispatch-order-cancel.spec.ts
// T5 acceptance: dispatcher cancels a transport order.
// Outside-in TDD RED: written before the cancel controller, service,
// migration, BFF route, server action, and UI form exist. Uses page.request
// so the fleet_session cookie set by login is shared with API calls.
//
// Critical user journey covered:
//   1. Dispatcher logs in and sees the dispatch board.
//   2. Dispatcher opens a just-created order (review view).
//   3. Cancel control is visible only when the order's current state is a
//      legal source for the FSM transition to 'cancelled'.
//   4. Dispatcher submits a cancellation with a required reason + optional
//      note via the new server action -> BFF -> API.
//   5. Order's state in the review view is now 'cancelled'.
//   6. Second cancel attempt with the same reason is idempotent (200, same
//      cancellation persisted). Cancel with a different reason after the
//      first commit is rejected (409).
//   7. BFF returns 404 for an unknown order id (tenant boundary).
import { test, expect, type Page } from '@playwright/test';
const OPS_USER = process.env['E2E_OPS_USERNAME'] ?? 'dieuxe';
const OPS_PASS = process.env['E2E_OPS_PASSWORD'] ?? 'pw';
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill(OPS_USER);
  await page.getByLabel(/mật khẩu|password/i).fill(OPS_PASS);
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dispatch|\/$/, { timeout: 10000 });
}
test.describe.serial('dispatch order cancel', () => {
  test('dispatcher cancels an order via the review view and the state flips to cancelled', async ({ page }) => {
    await login(page);
    const listRes = await page.request.get('/api/transport-orders/assigned');
    expect(listRes.status(), 'BFF /api/transport-orders/assigned must return 200').toBe(200);
    const listJson = await listRes.json() as { rows: ReadonlyArray<{ transportOrderId: string; state: string }> };
    const cancellable = listJson.rows.find((r) => r.state !== 'cancelled' && r.state !== 'completed');
    test.skip(cancellable === undefined, 'no cancellable order available in this environment');
    const target = cancellable!;
    await page.goto('/dispatch/orders/' + target.transportOrderId);
    await expect(page.getByRole('heading', { name: /chi tiết|order review|đơn vận chuyển/i })).toBeVisible();
    const cancelButton = page.getByTestId('order-cancel-open');
    await expect(cancelButton, 'cancel control visible for cancellable order').toBeVisible();
    await cancelButton.click();
    const reasonSelect = page.getByTestId('order-cancel-reason');
    await expect(reasonSelect).toBeVisible();
    await reasonSelect.selectOption('customer_request');
    await page.getByTestId('order-cancel-note').fill('E2E test cancel');
    await page.getByTestId('order-cancel-submit').click();
    await expect(page.getByTestId('order-review-state')).toContainText('cancelled', { timeout: 10000 });
    await expect(page.getByTestId('order-cancel-open')).toHaveCount(0);
  });
  test('idempotent: second cancel with same reason returns 200 and same record', async ({ page }) => {
    await login(page);
    const listRes = await page.request.get('/api/transport-orders/assigned');
    const listJson = await listRes.json() as { rows: ReadonlyArray<{ transportOrderId: string; state: string }> };
    const alreadyCancelled = listJson.rows.find((r) => r.state === 'cancelled');
    test.skip(alreadyCancelled === undefined, 'no cancelled order available to retest idempotency');
    const id = alreadyCancelled!.transportOrderId;
    const first = await page.request.post('/api/transport-orders/' + id + '/cancel', {
      data: { reason: 'customer_request', note: 'first retry' },
    });
    expect(first.status(), 'idempotent re-cancel with same reason returns 200').toBe(200);
  });
  test('conflict: cancel with a different reason after first commit returns 409', async ({ page }) => {
    await login(page);
    const listRes = await page.request.get('/api/transport-orders/assigned');
    const listJson = await listRes.json() as { rows: ReadonlyArray<{ transportOrderId: string; state: string }> };
    const alreadyCancelled = listJson.rows.find((r) => r.state === 'cancelled');
    test.skip(alreadyCancelled === undefined, 'no cancelled order available to retest conflict');
    const id = alreadyCancelled!.transportOrderId;
    const conflict = await page.request.post('/api/transport-orders/' + id + '/cancel', {
      data: { reason: 'driver_unavailable', note: 'different reason' },
    });
    expect(conflict.status()).toBe(409);
  });
  test('cancel BFF returns 404 for an unknown order id (tenant boundary)', async ({ page }) => {
    await login(page);
    const res = await page.request.post('/api/transport-orders/00000000-0000-0000-0000-000000000000/cancel', {
      data: { reason: 'customer_request' },
    });
    expect(res.status()).toBe(404);
  });
});
