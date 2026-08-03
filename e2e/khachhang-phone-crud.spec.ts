// e2e/khachhang-phone-crud.spec.ts
// L0 ACCEPTANCE: a dispatcher can record and change a customer's Số điện thoại.
//
// Business invariant: a Khách hàng row carries an optional Số điện thoại that
// round-trips create -> read -> update through the real UI and the API.
//
// Sửa SĐT is reached through the row's own action menu, never as a bare row
// button: reference-sections.tsx renders it as a RowActionMenu action behind a
// trigger named for that row, so the menu must be opened first.
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const BUDGET_MS = 15_000;

test.describe('Khách hàng: Số điện thoại create and update', () => {
  test('phone round-trips through create and update', async ({ page }) => {
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    const customerName = 'E2E-KHACH-PHONE-' + rand;
    const phone = '0901' + String(Date.now()).slice(-6);
    const newPhone = '0902' + String(Date.now()).slice(-6);

    await test.step('Authenticate and open reference data', async () => {
      await loginAs(page);
      await page.goto('/admin/reference');
      await expect(
        page.getByRole('heading', { name: 'Quản lý dữ liệu điều phối' }),
      ).toBeVisible({ timeout: BUDGET_MS });
    });

    const customerSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Khách hàng' }) });

    await test.step('Create customer with phone', async () => {
      await customerSection.getByPlaceholder('Thêm khách hàng').fill(customerName);
      await customerSection.getByPlaceholder('Số điện thoại').fill(phone);
      await customerSection.getByRole('button', { name: 'Thêm khách hàng' }).click();
    });

    const row = customerSection.getByRole('row').filter({ hasText: customerName });

    await test.step('Verify the created phone is rendered', async () => {
      await expect(row).toBeVisible({ timeout: BUDGET_MS });
      await expect(row).toContainText(phone);
    });

    await test.step('Edit the phone through the row action menu', async () => {
      await row
        .getByRole('button', { name: 'Thao tác cho ' + customerName })
        .click();
      await page.getByRole('menuitem', { name: 'Sửa SĐT' }).click();
      const editInput = row.getByLabel('Số điện thoại');
      await expect(editInput).toBeVisible({ timeout: BUDGET_MS });
      await editInput.fill(newPhone);
      await row.getByRole('button', { name: 'Lưu' }).click();
      // Observe the save COMPLETING before reloading. Reloading straight after
      // the click races the update request: a lost race reads as a persistence
      // failure when the write simply had not landed yet.
      await expect(editInput).toBeHidden({ timeout: BUDGET_MS });
      await expect(row).toContainText(newPhone, { timeout: BUDGET_MS });
    });

    await test.step('Reload and verify the value persisted server-side', async () => {
      await page.reload();
      const persistedRow = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Khách hàng' }) })
        .getByRole('row')
        .filter({ hasText: customerName });
      await expect(persistedRow).toContainText(newPhone, { timeout: BUDGET_MS });
      await expect(persistedRow).not.toContainText(phone);
    });
  });
});
