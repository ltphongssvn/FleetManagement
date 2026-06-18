// e2e/dispatcher-labels.spec.ts
// T4 acceptance: dispatcher recognizes their just-created transport order
// by human-readable labels in the Lệnh điều xe table.
// Outside-in TDD RED: written before labels.ts and DispatchBoard label
// integration exist. Asserts the user-visible behavior, not implementation.
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';


// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test.describe.serial('dispatcher recognizes orders by human-readable labels', () => {
  test('table displays Số lệnh column with the order ref as primary key', async ({ page }) => {
    await login(page);
    const board = page.getByRole('table').filter({ hasText: /Lệnh điều xe|Mã lệnh|Số lệnh/i });
    await expect(board).toBeVisible({ timeout: 15_000 });
    // The primary recognition key must be the dispatcher-entered Số lệnh,
    // not an opaque 8-char UUID slice. Header must read 'Số lệnh'.
    await expect(board.locator('thead')).toContainText(/Số lệnh/);
  });
  test('driver and vehicle columns show human names, not raw UUIDs', async ({ page }) => {
    await login(page);
    const board = page.getByRole('table').filter({ hasText: /Lệnh điều xe|Mã lệnh|Số lệnh/i });
    await expect(board).toBeVisible({ timeout: 15_000 });
    const rows = board.locator('tbody tr');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, 'no dispatch rows seeded in this environment');
    // Scan every visible row: no cell should contain a raw UUID (8-4-4-4-12 hex).
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (let i = 0; i < rowCount; i++) {
      const rowText = (await rows.nth(i).innerText()).trim();
      expect(rowText, 'row ' + String(i) + ' should not contain a raw UUID: ' + rowText).not.toMatch(uuidPattern);
    }
  });
  test('Số lệnh column shows the dispatcher-entered ref like XTT.MM-NNN, not a hash slice', async ({ page }) => {
    await login(page);
    const board = page.getByRole('table').filter({ hasText: /Lệnh điều xe|Mã lệnh|Số lệnh/i });
    await expect(board).toBeVisible({ timeout: 15_000 });
    const firstCell = board.locator('tbody tr').first().locator('td').first();
    const cellCount = await board.locator('tbody tr').count();
    test.skip(cellCount === 0, 'no dispatch rows seeded in this environment');
    // Must look like a real order ref (e.g. XT.0067 / TO-1001 / E2E-...) -- letters then a separator then digits -- not an 8-hex slice like '0f1465bd'.
    await expect(firstCell).toHaveText(/[A-Z][A-Z0-9]*[-.\u002E][0-9A-Z-]+/);
  });
});
