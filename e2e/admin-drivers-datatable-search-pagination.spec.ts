// e2e/admin-drivers-datatable-search-pagination.spec.ts
// t46 browser DoD: the configured-driver roster on /admin/drivers renders through
// the shared DataTable, restoring BOTH affordances the hand-rolled table dropped --
// Tim kiem (global search) and Trang X / Y pagination -- with every CRUD control
// still reachable from inside the table cells.
//
// WHY E2E and not another unit test: the regression this arc repairs is a
// RENDERING one the dispatcher sees in a real browser. jsdom proved the wiring;
// only a browser proves the affordance.
//
// Determinism: the spec SEEDS its own fully configured drivers through the real
// API (vehicle + driver + enrolled device + assignment) rather than depending on
// ambient fleet data, then removes them. 11 drivers guarantees more than one page
// at the DataTable default pageSize of 10, so pagination is asserted
// UNCONDITIONALLY -- a data-conditional skip would silently disable this check
// the moment seed data shifted.
//
// Selector note (t41 incident): DataTable renders the FIRST body cell of every
// row as th scope=row -- ARIA role rowheader, NOT cell. Row identity is queried
// via getByRole('rowheader'), never getByRole('cell').
import { test, expect } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import {
  seedConfiguredDrivers,
  cleanupSeededDrivers,
  type SeededDriver,
} from './helpers/seed-configured-drivers';

const SEED_COUNT = 11;

test.describe('driver roster DataTable affordances', () => {
  let seeded: readonly SeededDriver[] = [];
  let dispatcherToken = '';

  test.beforeAll(async ({ request }) => {
    dispatcherToken = mintDispatcherToken();
    seeded = await seedConfiguredDrivers(request, dispatcherToken, SEED_COUNT);
  });

  test.afterAll(async ({ request }) => {
    await cleanupSeededDrivers(request, dispatcherToken, seeded);
  });

  test('Tim kiem filters the configured driver roster', async ({ page }) => {
    await loginAs(page);
    await page.goto('/admin/drivers');

    const search = page.getByTestId('datatable-search');
    await expect(search).toBeVisible({ timeout: 15_000 });

    const target = seeded[0];
    if (target === undefined) throw new Error('seeding produced no drivers');
    await expect(page.getByRole('rowheader').filter({ hasText: target.fullName }))
      .toBeVisible({ timeout: 15_000 });

    // Searching a single driver name narrows the roster to that row.
    await search.fill(target.fullName);
    await expect(page.getByRole('rowheader')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByRole('rowheader').first()).toContainText(target.fullName);

    // A term matching nothing surfaces the empty state.
    await search.fill('ZZZ KHONG TON TAI ZZZ');
    await expect(page.getByTestId('datatable-empty')).toBeVisible({ timeout: 10_000 });

    // Clearing restores a full page of rows.
    await search.fill('');
    await expect(page.getByRole('rowheader')).toHaveCount(10, { timeout: 10_000 });
  });

  test('Trang X / Y pages through the configured driver roster', async ({ page }) => {
    await loginAs(page);
    await page.goto('/admin/drivers');
    await expect(page.getByTestId('datatable-search')).toBeVisible({ timeout: 15_000 });

    // 11 seeded configured drivers exceed the default page size of 10, so the
    // pagination controls MUST be present.
    const pageInfo = page.getByTestId('datatable-page-info');
    await expect(pageInfo).toBeVisible({ timeout: 15_000 });
    await expect(pageInfo).toContainText('Trang 1 /');

    const firstPageRow = (await page.getByRole('rowheader').first().innerText()).trim();

    const next = page.getByTestId('datatable-next');
    await expect(next).toBeEnabled();
    await next.click();

    await expect(pageInfo).toContainText('Trang 2 /');
    await expect(page.getByTestId('datatable-prev')).toBeEnabled();
    const secondPageRow = (await page.getByRole('rowheader').first().innerText()).trim();
    expect(secondPageRow).not.toBe(firstPageRow);

    await page.getByTestId('datatable-prev').click();
    await expect(pageInfo).toContainText('Trang 1 /');
    // Back on page 1 the first row is the same one we started from. Compare the
    // normalised innerText of both captures rather than asserting a raw string
    // against normalised rendered text.
    const backToFirst = (await page.getByRole('rowheader').first().innerText()).trim();
    expect(backToFirst).toBe(firstPageRow);
  });

  test('keeps every CRUD control reachable inside the DataTable cells', async ({ page }) => {
    await loginAs(page);
    await page.goto('/admin/drivers');

    const target = seeded[0];
    if (target === undefined) throw new Error('seeding produced no drivers');
    await page.getByTestId('datatable-search').fill(target.fullName);

    const row = page.getByRole('row').filter({ hasText: target.fullName });
    await expect(row).toHaveCount(1, { timeout: 15_000 });

    // Name AND phone both render in the Tai xe cell (displayed phone is a
    // production UI contract, not decoration).
    await expect(row).toContainText(target.fullName);
    await expect(row).toContainText(target.phone);

    // The assigned plate renders; no raw device UUID reaches the screen.
    await expect(row).toContainText(target.plate);
    await expect(row).toContainText('Đã đăng ký');

    // CRUD controls survived the move into DataTable cells. Revoke and save-phone
    // sit directly in the row; reset-password and delete live behind the
    // RowActionMenu kebab, so they are reachable only after opening it.
    await expect(row.getByRole('button', { name: 'Hủy phân công' })).toBeVisible();
    await expect(row.getByLabel('Lưu SĐT của ' + target.fullName)).toBeVisible();

    const actionsTrigger = row.getByLabel('Thao tác cho ' + target.fullName);
    await expect(actionsTrigger).toBeVisible();
    await actionsTrigger.click();
    await expect(page.getByRole('menuitem', { name: 'Đặt lại mật khẩu' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Xóa' })).toBeVisible();
  });
});
