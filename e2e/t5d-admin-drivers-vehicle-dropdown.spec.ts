// e2e/t5d-admin-drivers-vehicle-dropdown.spec.ts
// T5d: 'Chọn số xe' dropdown on /admin/drivers must list the same
// vehicles as the 'Số xe' section of /admin/reference (admin-scope).
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';


// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test('Chọn số xe dropdown on /admin/drivers matches Số xe section on /admin/reference', async ({ page }) => {
  await login(page);
  await page.goto('/admin/reference');
  const vehiclesSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Số xe$/ }) });
  await expect(vehiclesSection).toBeVisible({ timeout: 15_000 });
  // The section now renders through the shared DataTable (TanStack v8): each
  // vehicle is a <tr> whose FIRST cell is the plate (Tên column). Iterate body
  // rows via getByRole('row'); the header is <th> (role=columnheader) with no
  // role=cell, so reading each row first cell naturally skips it. Semantic
  // selectors survive markup churn (2026 resilient-selector standard).
  const firstCell = vehiclesSection.getByRole('cell').first();
  await expect(firstCell).toBeVisible({ timeout: 10_000 });
  const rowLocators = await vehiclesSection.getByRole('row').all();
  const referencePlates: string[] = [];
  for (const row of rowLocators) {
    const cell = row.getByRole('cell').first();
    if ((await cell.count()) === 0) continue;
    const t = (await cell.textContent()) ?? '';
    if (t.trim().length > 0) referencePlates.push(t.trim());
  }
  expect(referencePlates.length).toBeGreaterThan(0);
  await page.goto('/admin/drivers');
  const firstDropdown = page.locator('select').filter({ hasText: /Chọn số xe/ }).first();
  await expect(firstDropdown).toBeVisible({ timeout: 15_000 });
  const dropdownOptions = await firstDropdown.locator('option').allTextContents();
  const dropdownPlates = dropdownOptions.map((t) => t.trim()).filter((t) => !t.includes('Chọn số xe'));
  for (const plate of referencePlates) {
    expect(dropdownPlates).toContain(plate);
  }
});
