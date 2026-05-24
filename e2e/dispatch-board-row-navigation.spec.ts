// e2e/dispatch-board-row-navigation.spec.ts
// T5 acceptance: dispatcher reaches the order review (and the cancel
// form) by clicking a row on the dispatch board, not by direct URL.
// This closes the production UI gap that the original cancel spec
// missed: in the PDF the row was a plain text cell with no link, so
// the dispatcher had no way to navigate into the review/cancel view.
//
// The flow under test:
//   1. Dispatcher logs in -> /dispatch board renders 'Lệnh điều xe'.
//   2. The Số lệnh cell for at least one row is a Next.js Link with
//      href=/dispatch/orders/{externalRef}.
//   3. Clicking the link navigates to the review page; the review
//      heading and the CancelOrderForm container are visible.
//   4. The review page accepts the human-readable external_ref (not
//      a UUID) thanks to the page-level resolver.
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
test.describe.serial('dispatch board row navigation (T5)', () => {
  test('the Số lệnh cell links to /dispatch/orders/{externalRef} for at least one row', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible();
    const rowLink = page.locator('a[href^=\"/dispatch/orders/\"]').first();
    await expect(rowLink, 'at least one dispatch board row must be linked to /dispatch/orders/...').toBeVisible({ timeout: 10000 });
    const href = await rowLink.getAttribute('href');
    expect(href).toMatch(/^\/dispatch\/orders\/.+$/);
  });
  test('clicking the row opens the review page with the cancel form composed below', async ({ page }) => {
    await login(page);
    await page.goto('/');
    const rowLink = page.locator('a[href^=\"/dispatch/orders/\"]').first();
    await rowLink.click();
    await expect(page).toHaveURL(/\/dispatch\/orders\/.+/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /chi tiết|order review|đơn vận chuyển/i })).toBeVisible();
    // Either a cancel button is visible (order is cancellable) or the
    // state is one of cancelled/completed (where the cancel form is
    // intentionally absent). Both prove the wiring is end-to-end.
    const stateEl = page.getByTestId('order-review-state');
    await expect(stateEl).toBeVisible();
    const state = (await stateEl.textContent())?.trim() ?? '';
    if (state === 'cancelled' || state === 'completed') {
      await expect(page.getByTestId('order-cancel-open')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('order-cancel-open')).toBeVisible();
    }
  });
});
