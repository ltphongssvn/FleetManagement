// e2e/dispatch-board-reflects-cancel.spec.ts
// T5 acceptance: cancelling a transport order from the review view must
// (a) navigate the dispatcher back to the Bảng điều phối board, and
// (b) update the board row's Trạng thái cell to 'cancelled' so the
// dispatcher sees a consistent view across the cancel boundary.
//
// Production bug captured from 1779591552385_Fleet_Ops.pdf + screenshot
// at /dispatch/orders/XT.0059: XT.0059 review page shows state='cancelled'
// but the board still shows the same XT.0059 row as 'planned'. The
// transport_order + road_run tables are correct in the live DB; the
// dispatch_board_projection is stale because the cancel service does not
// emit a sync_change_feed event for the projection runner to consume.
//
// Invariant under test: the board and the review page must agree on
// state for every road_run.
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
async function findCancellableRow(page: Page): Promise<{ ref: string }> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible({ timeout: 10000 });
  // Walk rows top-down looking for one whose state cell is not terminal.
  const rows = page.locator('table tbody tr');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const link = row.locator('a[href^=\"/dispatch/orders/\"]');
    if ((await link.count()) === 0) continue;
    const text = (await row.textContent()) ?? '';
    if (text.includes('cancelled') || text.includes('completed')) continue;
    const href = await link.getAttribute('href');
    if (href === null) continue;
    return { ref: href.replace('/dispatch/orders/', '') };
  }
  throw new Error('No cancellable row found on the dispatch board.');
}
test.describe.serial('dispatch board reflects cancellation (T5)', () => {
  test('cancelling from the review view navigates back to the board and the row shows cancelled', async ({ page }) => {
    await login(page);
    const { ref } = await findCancellableRow(page);
    // Open the review page for the picked row.
    await page.goto('/dispatch/orders/' + ref);
    await expect(page.getByRole('heading', { name: /chi tiết đơn vận chuyển/i })).toBeVisible();
    // Sanity-check current state via the testid the review view emits.
    const stateEl = page.getByTestId('order-review-state');
    const currentState = (await stateEl.textContent())?.trim() ?? '';
    expect(currentState).not.toBe('cancelled');
    expect(currentState).not.toBe('completed');
    // Open the cancel modal, fill the reason, submit.
    await page.getByTestId('order-cancel-open').click();
    await page.getByTestId('order-cancel-reason').selectOption('customer_request');
    await page.getByTestId('order-cancel-submit').click();
    // After a successful cancel the dispatcher should be returned to
    // the dispatch board (Bảng điều phối, rendered at '/').
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible();
    // The cancelled row's Trạng thái cell must now show 'cancelled'.
    // The row is identified by its Số lệnh link testid.
    const rowLink = page.getByTestId('dispatch-board-row-' + ref);
    await expect(rowLink).toBeVisible({ timeout: 10000 });
    const row = page.locator('tr', { has: rowLink });
    await expect(row).toContainText('cancelled', { timeout: 10000 });
  });
});
