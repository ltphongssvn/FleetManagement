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
  // Pick the first existing customer name as the duplicate to re-add. The
  // section now renders through the shared DataTable (TanStack v8): rows are
  // <tr><td>, and the name is the FIRST body cell. Header cells are <th>
  // (role=columnheader), so getByRole('cell').first() resolves to the first
  // DATA row name cell -- never a header -- and survives markup churn
  // (2026 resilient-selector standard).
  const firstExisting = section.getByRole('cell').first();
  await expect(firstExisting).toBeVisible({ timeout: 10_000 });
  const existingName = (await firstExisting.textContent())?.trim() ?? '';
  expect(existingName.length).toBeGreaterThan(0);
  await section.getByPlaceholder(/Thêm khách hàng/i).fill(existingName);
  await section.getByRole('button', { name: /^Thêm khách hàng$/ }).click();
  // The UI MUST render a friendly Vietnamese conflict message and MUST
  // NOT render the legacy 'HTTP 500' string anywhere on the page.
  await expect(section).toContainText(/đã tồn tại/i, { timeout: 10_000 });
  await expect(section).not.toContainText(/HTTP 500/);
});
