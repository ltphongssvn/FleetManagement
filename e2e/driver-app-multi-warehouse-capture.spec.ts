// e2e/driver-app-multi-warehouse-capture.spec.ts
// RED L0 outer acceptance test for the multi-warehouse manifest-capture
// business invariant (T2: feature/t2-driver-app-take-photo-receiving).
//
// Business invariant (permanent rule, never to be broken):
//   A complete delivery journey requires:
//     - A LOADING-MANIFEST receipt photo at EACH loading warehouse
//       (1..4 loading warehouses per journey).
//     - A DELIVERY-RECEIPT photo at THE single unloading warehouse.
//
// User-visible behaviour driven by this acceptance test:
//   The capture screen must distinguish the loading-warehouse stops (1..4)
//   from the single unloading-warehouse stop, so the driver always sees
//   which warehouse and which receipt-kind they are photographing. The
//   screen must also reject out-of-range / missing stop parameters.
//
// outside-in strict TDD: L0 RED first. Inner layers (state machine,
// presenter, route param parser) will each be driven by their own
// smaller RED tests before any production code is written.
import { test, expect, type Page } from '@playwright/test';

const DRIVER_APP_URL = process.env.DRIVER_APP_URL ?? 'http://localhost:8081';
const PAGE_TIMEOUT_MS = 180_000;
const EXPECT_TIMEOUT_MS = 60_000;
const ORDER_ID = '00000000-0000-0000-0000-000000000001';

test.describe.configure({ timeout: PAGE_TIMEOUT_MS });

async function loginAsDriver(page: Page): Promise<void> {
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultTimeout(EXPECT_TIMEOUT_MS);
  await page.goto(DRIVER_APP_URL + '/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Fleet Driver')).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  await page.getByPlaceholder('0900000001').fill('0900000001');
  await page.getByPlaceholder(/Nhập mật khẩu/).fill('driver1pass');
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await expect(page.getByText(/Xem lệnh điều xe/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
}

test.describe('driver-app multi-warehouse manifest capture (T2)', () => {
  test('loading warehouse stop 1 shows loading-manifest receipt label for warehouse 1', async ({ page }) => {
    await loginAsDriver(page);
    await page.goto(
      DRIVER_APP_URL + '/capture?transportOrderId=' + ORDER_ID + '&stopKind=loading&stopIndex=0',
      { waitUntil: 'domcontentloaded' },
    );
    await expect(
      page.getByRole('heading', { name: /Phiếu nhận hàng.*Kho nhận hàng 1/ }),
    ).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
    await expect(page.getByTestId('capture-stop-kind')).toHaveText(/loading/);
    await expect(page.getByTestId('capture-stop-index')).toHaveText(/^1$/);
  });

  test('loading warehouse stop 4 shows loading-manifest receipt label for warehouse 4', async ({ page }) => {
    await loginAsDriver(page);
    await page.goto(
      DRIVER_APP_URL + '/capture?transportOrderId=' + ORDER_ID + '&stopKind=loading&stopIndex=3',
      { waitUntil: 'domcontentloaded' },
    );
    await expect(
      page.getByRole('heading', { name: /Phiếu nhận hàng.*Kho nhận hàng 4/ }),
    ).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
    await expect(page.getByTestId('capture-stop-kind')).toHaveText(/loading/);
    await expect(page.getByTestId('capture-stop-index')).toHaveText(/^4$/);
  });

  test('unloading stop shows delivery-receipt label at the unloading warehouse', async ({ page }) => {
    await loginAsDriver(page);
    await page.goto(
      DRIVER_APP_URL + '/capture?transportOrderId=' + ORDER_ID + '&stopKind=unloading',
      { waitUntil: 'domcontentloaded' },
    );
    await expect(
      page.getByRole('heading', { name: /Phiếu giao hàng.*Kho dỡ hàng/ }),
    ).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
    await expect(page.getByTestId('capture-stop-kind')).toHaveText(/unloading/);
  });

  test('loading stop index out of range (>= 4) is rejected by the screen', async ({ page }) => {
    await loginAsDriver(page);
    await page.goto(
      DRIVER_APP_URL + '/capture?transportOrderId=' + ORDER_ID + '&stopKind=loading&stopIndex=4',
      { waitUntil: 'domcontentloaded' },
    );
    await expect(
      page.getByText(/Kho nhận hàng không hợp lệ/),
    ).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: /^Chụp ảnh$/ })).toHaveCount(0);
  });

  test('missing stopKind is rejected by the screen', async ({ page }) => {
    await loginAsDriver(page);
    await page.goto(
      DRIVER_APP_URL + '/capture?transportOrderId=' + ORDER_ID,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(
      page.getByText(/Thiếu thông tin điểm dừng|Kho nhận hàng không hợp lệ/),
    ).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  });
});
