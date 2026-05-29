// e2e/t5d-admin-drivers-vehicle-dropdown.spec.ts
// T5d: 'Chọn số xe' dropdown on /admin/drivers must list the same
// vehicles as the 'Số xe' section of /admin/reference (admin-scope).
import { test, expect } from '@playwright/test';
const OPS_USER = process.env['E2E_OPS_USERNAME'] ?? 'dieuxe';
const OPS_PASS = process.env['E2E_OPS_PASSWORD'] ?? 'dieuxe';
async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill(OPS_USER);
  await page.getByLabel(/mật khẩu|password/i).fill(OPS_PASS);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
    page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click(),
  ]);
}
test('Chọn số xe dropdown on /admin/drivers matches Số xe section on /admin/reference', async ({ page }) => {
  await login(page);
  await page.goto('/admin/reference');
  const vehiclesSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Số xe$/ }) });
  await expect(vehiclesSection).toBeVisible({ timeout: 15_000 });
  await expect(vehiclesSection.locator('ul li').first()).toBeVisible({ timeout: 10_000 });
  // The plate text is the first <span> inside each <li>; the Xóa button
  // lives in a sibling <span>. Use locator('ul li > span').first() per row.
  const liHandles = await vehiclesSection.locator('ul li').elementHandles();
  const referencePlates: string[] = [];
  for (const li of liHandles) {
    const span = await li.$('span');
    if (span === null) continue;
    const t = (await span.textContent()) ?? '';
    if (t.trim().length > 0) referencePlates.push(t.trim());
  }
  expect(referencePlates.length).toBeGreaterThan(0);
  await page.goto('/admin/drivers');
  const firstDropdown = page.locator('select').filter({ hasText: /Chọn số xe/ }).first();
  await expect(firstDropdown).toBeVisible({ timeout: 15_000 });
  const dropdownOptions = await firstDropdown.locator('option').allTextContents();
  const dropdownPlates = dropdownOptions.map((t) => t.trim()).filter((t) => !/Chọn số xe/.test(t));
  for (const plate of referencePlates) {
    expect(dropdownPlates).toContain(plate);
  }
});
