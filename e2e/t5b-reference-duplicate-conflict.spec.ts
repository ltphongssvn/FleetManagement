// e2e/t5b-reference-duplicate-conflict.spec.ts
// T5b acceptance (outside-in RED): adding a duplicate reference master
// data row must surface a friendly Vietnamese conflict message, never an
// HTTP 500.
//
// Business invariant (T5b):
//   POST /api/reference/{segment} that violates a unique constraint
//   MUST resolve as HTTP 409 (Conflict). The dispatcher UI MUST render
//   a localized message (vi: 'Tên đã tồn tại' / 'đã tồn tại') and MUST
//   NOT render any 'HTTP 500' string in the page.
//
// Critical user journey: a dispatcher opens 'Quản lý dữ liệu điều phối',
// adds a new 'Khách hàng' (customer) with a name that already exists in
// the seed data ('ĐA NẴNG'), and sees the friendly Vietnamese conflict
// message, never an HTTP 500.
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';


// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test('duplicate Khách hàng add surfaces friendly conflict, not HTTP 500', async ({ page }) => {
  await login(page);
  await page.goto('/admin/reference');
  await expect(page.getByRole('heading', { name: /Quản lý dữ liệu điều phối/i })).toBeVisible({ timeout: 15_000 });
  // Khách hàng section is the first <section>.
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Khách hàng$/ }) });
  await expect(section).toBeVisible({ timeout: 15_000 });
  // Pick the first existing customer label as the duplicate to re-add.
  // The customer row nests name + optional phone inside a flex wrapper span
  // (Số điện thoại UI, 2026): <span.flex><span>NAME</span><span>PHONE</span></span>.
  // Target the INNER name span only, or the concatenated name+phone text would
  // be used as the duplicate and never collide.
  const firstExisting = section.locator('ul li > div > span').first();
  const existingName = (await firstExisting.textContent())?.trim() ?? '';
  expect(existingName.length).toBeGreaterThan(0);
  await section.getByPlaceholder(/Thêm khách hàng/i).fill(existingName);
  await section.getByRole('button', { name: /^Thêm khách hàng$/ }).click();
  // The UI MUST render a friendly Vietnamese conflict message and MUST
  // NOT render the legacy 'HTTP 500' string anywhere on the page.
  await expect(section).toContainText(/đã tồn tại/i, { timeout: 10_000 });
  await expect(section).not.toContainText(/HTTP 500/);
});
