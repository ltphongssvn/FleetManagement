// e2e/driver-app-login.spec.ts
// E2E for the driver-app login screen. The React Native Web bundle served at
// http://localhost:8081 runs the exact same routes/components Expo Go runs on
// iOS/Android, so success here proves the on-device experience modulo the
// platform adapter layer.
import { test, expect, type Page } from '@playwright/test';

const DRIVER_APP_URL = process.env.DRIVER_APP_URL ?? 'http://localhost:8081';
// First bundle transform on a cold Metro can exceed 30s; even hot, the 8 MB
// dev bundle takes several seconds to download + parse + hydrate.
// Note: Metro keeps an HMR/SSE connection open, so 'networkidle' never fires.
const PAGE_TIMEOUT_MS = 180_000;
const EXPECT_TIMEOUT_MS = 60_000;

test.describe.configure({ timeout: PAGE_TIMEOUT_MS });

async function gotoAndHydrate(page: Page, path: string): Promise<void> {
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultTimeout(EXPECT_TIMEOUT_MS);
  await page.goto(DRIVER_APP_URL + path, { waitUntil: 'domcontentloaded' });
  // Wait for React Native Web to hydrate the root with our content.
  await expect(page.getByText('Fleet Driver')).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
}

test.describe('driver-app login screen', () => {
  test('auth gate redirects unauthenticated user from / to /login', async ({ page }) => {
    await gotoAndHydrate(page, '/');
    await expect(page.getByText(/Đăng nhập để xem lệnh điều xe/i)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  });

  test('renders phone, password and submit', async ({ page }) => {
    await gotoAndHydrate(page, '/login');
    await expect(page.getByPlaceholder('0900000001')).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
    await expect(page.getByPlaceholder(/Nhập mật khẩu/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: /Đăng nhập/ })).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  });

  test('rejects empty phone with Vietnamese error', async ({ page }) => {
    await gotoAndHydrate(page, '/login');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Vui lòng nhập số điện thoại/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  });

  test('rejects empty password with Vietnamese error', async ({ page }) => {
    await gotoAndHydrate(page, '/login');
    await page.getByPlaceholder('0900000001').fill('0900000001');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Vui lòng nhập mật khẩu/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  });

  test('shows server error on wrong credentials', async ({ page }) => {
    await gotoAndHydrate(page, '/login');
    await page.getByPlaceholder('0900000001').fill('0900000001');
    await page.getByPlaceholder(/Nhập mật khẩu/).fill('wrongpass');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Sai số điện thoại hoặc mật khẩu/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  });

  test('navigates to home after successful login', async ({ page }) => {
    await gotoAndHydrate(page, '/login');
    await page.getByPlaceholder('0900000001').fill('0900000001');
    await page.getByPlaceholder(/Nhập mật khẩu/).fill('driver1pass');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Xem lệnh điều xe/)).toBeVisible({ timeout: EXPECT_TIMEOUT_MS });
  });
});
