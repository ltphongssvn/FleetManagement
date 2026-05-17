// e2e/driver-app-capture.spec.ts
// E2E for the manifest-photo capture screen. RNW bundle at :8081 runs the
// same routes/components Expo Go runs on iOS/Android. RED until
// app/(app)/capture.tsx exists and is reachable from the home screen.
import { test, expect, type Page } from '@playwright/test';

const DRIVER_APP_URL = process.env.DRIVER_APP_URL ?? 'http://localhost:8081';
const PAGE_TIMEOUT_MS = 180_000;
const EXPECT_TIMEOUT_MS = 60_000;

test.describe.configure({ timeout: PAGE_TIMEOUT_MS });

async function gotoHydrate(page: Page, path: string): Promise<void> {
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultTimeout(EXPECT_TIMEOUT_MS);
  await page.goto(DRIVER_APP_URL + path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Fleet Driver')).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
}

test.describe('driver-app manifest capture screen', () => {
  test('capture route renders the idle capture screen', async ({ page }) => {
    await gotoHydrate(page, '/login');
    await page.getByPlaceholder('0900000001').fill('0900000001');
    await page.getByPlaceholder(/Nhập mật khẩu/).fill('driver1pass');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Xem lệnh điều xe/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
    await page.goto(DRIVER_APP_URL + '/capture', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Chụp ảnh phiếu giao hàng/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: /Chụp ảnh/ })).toBeVisible();
  });

  test('home screen has a link to the capture screen', async ({ page }) => {
    await gotoHydrate(page, '/login');
    await page.getByPlaceholder('0900000001').fill('0900000001');
    await page.getByPlaceholder(/Nhập mật khẩu/).fill('driver1pass');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Chụp ảnh phiếu/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  });
});
