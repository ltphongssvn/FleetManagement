// e2e/driver-app-login.spec.ts
// E2E for the driver-app login screen. The React Native Web bundle served at
// http://localhost:8081 runs the exact same routes/components Expo Go runs on
// iOS/Android, so success here proves the on-device experience modulo the
// platform adapter layer.
import { test, expect } from '@playwright/test';

const DRIVER_APP_URL = process.env.DRIVER_APP_URL ?? 'http://localhost:8081';
// First bundle transform on a cold Metro can exceed 30s. Subsequent loads
// are cached but each test still navigates and waits on hydration.
const NAV_TIMEOUT_MS = 180_000;

test.describe.configure({ timeout: NAV_TIMEOUT_MS });

test.describe('driver-app login screen', () => {
  test.beforeEach(async ({ page }) => {
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
  });

  test('auth gate redirects unauthenticated user from / to /login', async ({ page }) => {
    await page.goto(DRIVER_APP_URL + '/');
    await expect(page.getByText('Fleet Driver')).toBeVisible();
    await expect(page.getByText(/Đăng nhập để xem lệnh điều xe/i)).toBeVisible();
  });

  test('renders phone, password and submit', async ({ page }) => {
    await page.goto(DRIVER_APP_URL + '/login');
    await expect(page.getByPlaceholder('0900000001')).toBeVisible();
    await expect(page.getByPlaceholder(/Nhập mật khẩu/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Đăng nhập/ })).toBeVisible();
  });

  test('rejects empty phone with Vietnamese error', async ({ page }) => {
    await page.goto(DRIVER_APP_URL + '/login');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Vui lòng nhập số điện thoại/)).toBeVisible();
  });

  test('rejects empty password with Vietnamese error', async ({ page }) => {
    await page.goto(DRIVER_APP_URL + '/login');
    await page.getByPlaceholder('0900000001').fill('0900000001');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Vui lòng nhập mật khẩu/)).toBeVisible();
  });

  test('shows server error on wrong credentials', async ({ page }) => {
    await page.goto(DRIVER_APP_URL + '/login');
    await page.getByPlaceholder('0900000001').fill('0900000001');
    await page.getByPlaceholder(/Nhập mật khẩu/).fill('wrongpass');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    await expect(page.getByText(/Sai số điện thoại hoặc mật khẩu/)).toBeVisible();
  });

  test('navigates to home after successful login', async ({ page }) => {
    await page.goto(DRIVER_APP_URL + '/login');
    await page.getByPlaceholder('0900000001').fill('0900000001');
    await page.getByPlaceholder(/Nhập mật khẩu/).fill('driver1pass');
    await page.getByRole('button', { name: /Đăng nhập/ }).click();
    // After auth state flips to 'authenticated', the user must land on the
    // home stack (the Vietnamese label below comes from app/(app)/index.tsx).
    await expect(page.getByText(/Xem lệnh điều xe/)).toBeVisible();
  });
});
