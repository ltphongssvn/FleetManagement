// e2e/t5c-conflict-display-consistency.spec.ts
// T5c acceptance (outside-in): after the dispatcher tries to re-add a
// name that already exists in the database (whether active or
// soft-deleted), the section MUST display the item. Two valid outcomes
// satisfy the consistency invariant:
//   (a) The row was soft-deleted: server reactivates it; row appears,
//       no error banner (success path).
//   (b) The row was already active: server returns 409; UI shows error
//       banner AND highlights/scrolls to the existing row.
// Either way, the dispatcher never sees an inconsistent state.
//
// Critical user journey: always display items that already exist.
//
// MARKUP CONTRACT MIGRATED (Co so du lieu arc): sections render through the
// shared DataTable, so a row is a <tr> of <td> cells, not a <ul><li>. The
// invariant is unchanged; the locator moves to getByRole(cell), which is
// semantic and survives the next markup change.
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';


// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}

interface SectionCase {
  readonly heading: RegExp;
  readonly placeholder: RegExp;
  readonly addButton: RegExp;
  readonly seedName: string;
}

const CASES: readonly SectionCase[] = [
  { heading: /^Khách hàng$/, placeholder: /Thêm khách hàng/i, addButton: /^Thêm khách hàng$/, seedName: 'ĐA NẴNG' },
  { heading: /^Tên hàng$/,   placeholder: /Thêm tên hàng/i,   addButton: /^Thêm tên hàng$/,   seedName: 'TẤM' },
  { heading: /^Số xe$/,      placeholder: /Thêm số xe/i,      addButton: /^Thêm số xe$/,      seedName: '62H 05194' },
  { heading: /^Kho nhận hàng$/, placeholder: /Thêm kho nhận hàng/i, addButton: /^Thêm kho nhận hàng$/, seedName: 'Chơn Chính' },
  { heading: /^Kho giao hàng$/, placeholder: /Thêm kho giao hàng/i, addButton: /^Thêm kho giao hàng$/, seedName: '3 ĐỰC' },
];

for (const c of CASES) {
  test('re-adding existing ' + c.seedName + ' makes it visible in the listing (no inconsistent state)', async ({ page }) => {
    await login(page);
    await page.goto('/admin/reference');
    await expect(page.getByRole('heading', { name: /Quản lý dữ liệu điều phối/i })).toBeVisible({ timeout: 15_000 });
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: c.heading }) });
    await expect(section).toBeVisible({ timeout: 15_000 });
    await section.getByPlaceholder(c.placeholder).fill(c.seedName);
    await section.getByRole('button', { name: c.addButton }).click();
    // Wait for the request to complete. The item must now appear in the
    // listing -- either because the server reactivated it (success) or
    // because the server returned 409 and the UI highlighted the
    // already-active row. Either way the consistency invariant holds.
    const nameCell = section.getByRole('cell', { name: c.seedName, exact: true });
    await expect(nameCell.first()).toBeVisible({ timeout: 10_000 });
  });
}
