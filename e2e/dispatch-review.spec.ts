// e2e/dispatch-review.spec.ts
// T2 acceptance: dispatcher reviews a just-made transport order.
// Outside-in TDD RED: written before OrderReview.tsx, BFF route, and review controller exist.
// Uses page.request so the fleet_session cookie set by login is shared with API calls.
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';
// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}
test.describe.serial('dispatch order review', () => {
  test('dispatcher can open a just-created order and see its details', async ({ page }) => {
    await login(page);
    const listRes = await page.request.get('/api/transport-orders/assigned');
    expect(listRes.status(), 'BFF /api/transport-orders/assigned must return 200').toBe(200);
    const listJson = await listRes.json() as { rows: readonly { transportOrderId: string; externalRef: string | null }[] };
    test.skip(listJson.rows.length === 0, 'no assigned order available to review in this environment');
    const target = listJson.rows[0];
    if (target === undefined) throw new Error('unreachable: skipped above');
    const reviewRes = await page.request.get('/api/transport-orders/' + target.transportOrderId);
    expect(reviewRes.status(), 'BFF /api/transport-orders/[id] must return 200 for a known order').toBe(200);
    await page.goto('/dispatch/orders/' + target.transportOrderId);
    await expect(page.getByRole('heading', { name: /order review|đơn vận chuyển|chi tiết/i })).toBeVisible();
    await expect(page.getByTestId('order-review-id')).toContainText(target.transportOrderId);
    if (target.externalRef) {
      await expect(page.getByTestId('order-review-external-ref')).toContainText(target.externalRef);
    }
    await expect(page.getByTestId('order-review-stops')).toBeVisible();
  });
  test('review BFF returns 404 for an unknown order id', async ({ page }) => {
    await login(page);
    const res = await page.request.get('/api/transport-orders/00000000-0000-0000-0000-000000000000');
    expect(res.status()).toBe(404);
  });
});
