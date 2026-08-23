// e2e/khachhang-phone-crud.spec.ts
// L0 ACCEPTANCE (2026): permanent business rule. In Quản lý dữ liệu điều phối
// the Khách hàng section supports CRUD for Số điện thoại (customer phone).
//
// Critical user journey: a dispatcher adds a Khách hàng WITH a Số điện thoại,
//   sees the phone rendered next to the customer, edits it, and the new value
//   persists.
// Business invariant: a customer row carries an optional Số điện thoại that
//   round-trips create -> read -> update through the real UI and the API.
//
// Outside-in: this fails first because (a) the Khách hàng section has no
//   Số điện thoại input, (b) the list renders no phone, and (c) the API
//   customer create/list/update carry no phone. It drives the i18n string (L1),
//   the admin section phone field + render (L1), the browser client phone
//   payload (L2), the API DTO phone (L3), the service phone persistence (L4),
//   and the schema phone column (L5).
//
// MARKUP CONTRACT MIGRATED (Co so du lieu arc): the Khách hàng section now
//   renders through the shared DataTable, so a row is a <tr> of <td> cells,
//   not a <ul><li>. Every invariant below is unchanged; only the row locator
//   moves to getByRole(row) -- semantic, and it survives markup churn.
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
const BUDGET_MS = 15_000;
test.describe.serial('Khách hàng: Số điện thoại CRUD', () => {
  test('add customer with phone, see it, edit it, value persists', async ({ page }) => {
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    const customerName = 'E2E-KHACH-PHONE-' + rand;
    const phone = '0901' + String(Date.now()).slice(-6);
    const newPhone = '0902' + String(Date.now()).slice(-6);
    // Authenticate via injected session (PKCE login has no credential form).
    await loginAs(page);
    await page.goto('/admin/reference');
    await expect(page.getByRole('heading', { name: 'Quản lý dữ liệu điều phối' })).toBeVisible({
      timeout: BUDGET_MS,
    });
    // Scope to the Khách hàng section (first section with that heading).
    const customerSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Khách hàng' }) });
    // INVARIANT 1: a Số điện thoại input exists in the Khách hàng section.
    const nameInput = customerSection.getByPlaceholder('Thêm khách hàng');
    const phoneInput = customerSection.getByPlaceholder('Số điện thoại');
    await expect(phoneInput).toBeVisible({ timeout: BUDGET_MS });
    // CREATE with name + phone via the real UI.
    await nameInput.fill(customerName);
    await phoneInput.fill(phone);
    await customerSection.getByRole('button', { name: 'Thêm khách hàng' }).click();
    // INVARIANT 2: the created customer's row shows the phone.
    const row = customerSection.getByRole('row').filter({ hasText: customerName });
    await expect(row).toBeVisible({ timeout: BUDGET_MS });
    await expect(row).toContainText(phone);
    // UPDATE the phone via the row's Thao tác (kebab) menu. Sửa SĐT was
    // consolidated into the row menu (2026 dense-table action consolidation),
    // so the edit control is reached through the menu, not as a row button.
    // MenuItems render in a portal, so the menuitem is queried on the page.
    await row.getByRole('button', { name: /Thao tác/ }).click();
    await page.getByRole('menuitem', { name: 'Sửa SĐT' }).click();
    const editInput = row.getByLabel('Số điện thoại');
    await expect(editInput).toBeVisible({ timeout: BUDGET_MS });
    await editInput.fill(newPhone);
    await row.getByRole('button', { name: 'Lưu' }).click();
    // Observe the save COMPLETING before reloading. Reloading straight after
    // the click races the update request, and a lost race reads as a broken
    // INVARIANT 3 when the write had simply not landed yet -- the flake class
    // that has been costing this suite reruns. Edit mode closing and the new
    // value rendering are the UI's own signals that the write returned.
    await expect(editInput).toBeHidden({ timeout: BUDGET_MS });
    await expect(row).toContainText(newPhone, { timeout: BUDGET_MS });
    // INVARIANT 3: the new phone persists after a reload (server round-trip).
    await page.reload();
    const customerSection2 = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Khách hàng' }) });
    const row2 = customerSection2.getByRole('row').filter({ hasText: customerName });
    await expect(row2).toContainText(newPhone, { timeout: BUDGET_MS });
    // The OLD value must be gone. Without this a stale render still showing
    // the previous phone alongside the new one would pass as a successful
    // update, which is exactly the failure INVARIANT 3 exists to catch.
    await expect(row2).not.toContainText(phone);
  });
});
