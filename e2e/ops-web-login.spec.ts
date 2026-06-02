// e2e/ops-web-login.spec.ts
// First Playwright e2e: ops-web login page renders and accepts input.
// Asserts behavior the user sees, not implementation details.
import { test, expect } from '@playwright/test';

test.describe('ops-web /login', () => {
  test('renders Vietnamese login form with username and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/tên đăng nhập|username/i)).toBeVisible();
    await expect(page.getByLabel(/mật khẩu|password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /đăng nhập|sign in|log in/i })).toBeEnabled();
  });

  test('blocks empty submission via HTML5 required (browser-level validation)', async ({ page }) => {
    await page.goto('/login');
    const username = page.getByLabel(/username|tên đăng nhập/i);
    await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
    // HTML5 required prevents submission; field is reported invalid by the browser.
    const isInvalid = await username.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('server-side validation triggers when JS submit bypasses HTML5 required', async ({ page }) => {
    await page.goto('/login');
    // Strip required attrs so the form action receives empty values.
    await page.evaluate(() => {
      document.querySelectorAll<HTMLInputElement>('input[required]').forEach((el) => { el.removeAttribute('required'); });
    });
    await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
    await expect(page.getByText(/required|bắt buộc/i).first()).toBeVisible();
  });
});
